'use strict';
/**
 * The two focused landing pages (owner approval 21 Oct 2026: "ghost pages to keep out of NAV
 * for SEO"), each inside one of the four services (scripts/lib/service_pages.js):
 *
 *   hotel  /services/hotel-room-decor-memphis   hotel room decoration memphis, romantic /
 *          (the existing URL, rebuilt in place)  anniversary / proposal / birthday hotel room
 *                                                setups; parent: party planning & decor
 *                                                (/services/celebration-setups#hotel-room-setups)
 *   lawn   /rentals/giant-lawn-games-memphis    lawn game rentals, giant yard games, giant
 *                                                connect four rental, cornhole rental memphis;
 *                                                parent: party game rentals (/rentals/#giant-lawn-games)
 *
 * Never in the header or footer nav. Linked from the parent's named sub-section (now short,
 * pointing here), from the sibling block of all 32 city pages, and listed in sitemap.xml and
 * the llms files. Canonical = itself; each links back to its parent service page.
 *
 * Every price, game and bundle comes from data/offers/services.json and data/rentals/games.json
 * (availableNow items only); FAQ answers are the owner-approved /faq/ answers
 * (scripts/lib/faq_content.js) wherever one exists. Pictures are the registered AI pictures in
 * data/offers/service_ai_images.json ("hotel": the owner's bedroom, hallway and anniversary photos; "lawn": AI): no captions, never presented as
 * past customer jobs; lawn pictures map only to availableNow items.
 *
 * Rendered by scripts/generators/build_focus_pages.js; checked by
 * scripts/validators/validate_service_pages.js.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const RENTALS = INV.resolve(require(path.join(ROOT, 'data/rentals/games.json')));

const { money, esc } = SP;
const DOMAIN = offers.domain;
const PAY = offers.payment;
const PICK = RENTALS.pickup;
const RATE = RENTALS.rates;
const BUNDLES = INV.offeredBundles(RENTALS);
const LAWN = SP.lawnGames;

function faq(id, q, as) {
  const FAQ = require(path.join(ROOT, 'scripts/lib/faq_content.js'));
  const sec = FAQ.SECTIONS.find((s) => s.id === id);
  const hit = sec && sec.qa.find(([x]) => x === q);
  if (!hit) throw new Error(`focus_pages: /faq/ section ${id} has no question "${q}"`);
  return [as || q, hit[1]];
}

const parentOf = (key) => SP.PAGES.find((p) => p.key === key);

const PAGES = [
  {
    key: 'hotel', file: 'services/hotel-room-decor-memphis.html', url: SP.FOCUS.hotel, parent: 'party', anchor: 'hotel-room-setups',
    request: 'party', areaService: 'party-decor', from: SP.partyFrom,
    title: 'Hotel Room Setups in Memphis | Porch &amp; Party',
    description: `Romantic, anniversary, proposal and birthday hotel room setups in Memphis, from ${money(SP.partyFrom)}: rose petals, candles, balloons and a bouquet, ready before you arrive.`,
    eyebrow: 'Hotel Room Setups', h1: 'Hotel room setups in Memphis',
    crumb: 'Hotel Room Setups',
    targets: ['hotel room decoration memphis', 'romantic hotel room setup memphis', 'anniversary hotel room decor memphis', 'proposal hotel room decor memphis', 'birthday hotel room decor memphis'],
    answer: `Porch &amp; Party decorates Memphis-area hotel rooms for anniversaries, proposals, birthdays and romantic surprises, from ${money(SP.partyFrom)}. Rose petals and candles, balloons by the bed, a bouquet and styled touches, set up and ready before your person walks in.`,
    serviceName: 'Hotel room setups in Memphis', serviceType: 'Hotel room decoration',
    sections: () => [
      { id: 'romantic-hotel-room-setup', h2: 'Romantic and anniversary hotel room setups',
        body: `<p>A heart of red rose petals on the bed, candles on the nightstands, white, gold or red balloons by the headboard and a bouquet on the pillows: the classic romantic room, for an anniversary, a getaway night or "just because". To match colors, send a photo or a Pinterest link with your request.</p>` },
      { id: 'proposal-hotel-room-setup', h2: 'Proposal hotel room decor',
        body: '<p>A path of rose petals and candles from the door to the bed, roses waiting where the question gets asked. We set it up while you are out and are gone before the two of you walk in.</p>' },
      { id: 'birthday-hotel-room-setup', h2: 'Birthday hotel room decor',
        body: '<p>A balloon garland over the headboard, gifts and a small bouquet on the bed and soft lights: a birthday surprise for a staycation or a night out in Memphis.</p>' },
      { id: 'hotel-access-and-price', h2: 'Hotel access, timing and price',
        body: `<p>${esc(faq('party', 'Home, hotel or venue?')[1].replace(/^All three\. /, ''))} ${esc(faq('party', 'How long does setup take?')[1])}</p><p>Hotel room setups start at ${money(SP.partyFrom)}. ${esc(faq('party', 'How much does party or room decor cost?')[1].replace(/^From \$[0-9,]+\+?\. /, ''))} ${esc(offers.addOns.takedown.line)}</p>` },
    ],
    faq: () => [
      ['Can you decorate a hotel room before we arrive?', `Yes. ${faq('party', 'Home, hotel or venue?')[1].replace(/^All three\. /, '').replace(/; for a venue[^.]*\./, '.')} ${faq('party', 'How long does setup take?')[1]}`],
      faq('party', 'How much does party or room decor cost?', 'How much does a hotel room setup cost?'),
      faq('party', 'What do you set up?', 'What can a hotel room setup include?'),
      ['How far ahead should I book?', 'Two to three weeks ahead is comfortable for most anniversaries and birthdays, and earlier for weekends in spring and December.'],
      faq('party', 'What happens afterwards?', 'Do you take it down afterwards?'),
      ['How do I pay?', `Your date is held by ${PAY.decorHold}, paid by ${PAY.methods} from your invoice. The rest is due ${PAY.decorBalanceDue}. ${PAY.methods} only; we do not take cash or cards.`],
    ],
  },
  {
    key: 'lawn', file: 'rentals/giant-lawn-games-memphis.html', url: SP.FOCUS.lawn, parent: 'rentals', anchor: 'giant-lawn-games',
    request: 'rentals', areaService: 'party-game-rentals', from: RATE.day,
    title: 'Giant Lawn Game Rentals in Memphis | Porch &amp; Party',
    description: `Giant yard game rentals in Memphis: ${INV.joinAnd(LAWN.map((g) => g.name))}, ${money(RATE.day)} a game a day, picked up at ${PICK.place.split(",")[0]}.`,
    eyebrow: 'Giant Lawn Games', h1: 'Giant lawn game rentals in Memphis',
    crumb: 'Giant Lawn Games',
    targets: ['lawn game rentals memphis', 'giant yard games memphis', 'giant connect four rental memphis', 'cornhole rental memphis'],
    answer: `Porch &amp; Party rents giant lawn games in Memphis for ${money(RATE.day)} a game per day or ${money(RATE.weekend)} for the weekend: ${esc(INV.joinAnd(LAWN.map((g) => g.name)))}. You pick up and return at ${esc(PICK.place)}, a safe exchange zone, with your photo ID.`,
    serviceName: 'Giant lawn game rentals in Memphis', serviceType: 'Party equipment rental',
    sections: () => [
      { id: 'giant-yard-games', h2: 'Giant yard games you can rent',
        body: `<ul>${LAWN.map((g) => `<li><strong>${esc(g.name)}</strong>: ${esc(g.size)}. ${money(RATE.day)} a day, ${money(RATE.weekend)} a weekend. <a href="/rentals/#${g.slug}">Details</a></li>`).join('')}</ul><p>Every game is available now. ${esc(faq('rentals', 'Can we use the games indoors?')[1].split('. ')[0])}.</p>` },
      { id: 'lawn-game-bundles', h2: 'Lawn game bundles',
        body: `<ul>${BUNDLES.filter((b) => !(b.items || []).length).map((b) => `<li><strong>${esc(b.name)}</strong>: ${esc(INV.lcFirst(b.includes))}, ${money(b.dayPrice)}${b.weekendPrice ? ` a day or ${money(b.weekendPrice)} a weekend` : ''}.</li>`).join('')}</ul><p>There is no minimum order. <a href="/rentals/#bundles">All bundles, with the movie screen and card table</a></p>` },
      { id: 'pickup-and-return', h2: 'Pickup and return at Mt. Moriah Station',
        body: `<p>${esc(faq('rentals', 'Where do I pick up?')[1])}</p><p>${esc(faq('rentals', 'What do I need to bring?')[1])} ${esc(faq('rentals', 'How long is a rental?')[1])}</p>` },
    ],
    faq: () => [
      ['How much do giant lawn games cost to rent?', `Every game is ${money(RATE.day)} a day or ${money(RATE.weekend)} for a weekend. Bundles: ${BUNDLES.filter((b) => !(b.items || []).length).map((b) => `${b.name} ${money(b.dayPrice)}`).join(', ')}. There is no minimum order.`],
      ['Which giant yard games can I rent?', `${INV.joinAnd(LAWN.map((g) => `${g.name} (${g.size})`))}. All are available now.`],
      faq('rentals', 'Where do I pick up?'),
      faq('rentals', 'What do I need to bring?'),
      faq('rentals', 'How far ahead should I book?'),
      faq('rentals', 'What happens if it rains?'),
    ],
  },
];

const imagesFor = (key) => SP.imagesFor(key);

function faqJsonLd(p) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: p.faq().map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
}

function serviceJsonLd(p) {
  const C = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
  const areas = require(path.join(ROOT, 'data/service_areas/areas.json')).areas;
  const parent = parentOf(p.parent);
  const offer = p.key === 'hotel'
    ? { '@type': 'Offer', priceCurrency: 'USD', price: p.from, priceSpecification: { '@type': 'PriceSpecification', minPrice: p.from, priceCurrency: 'USD' }, description: `Hotel room setups from ${money(p.from)}.`, url: `${DOMAIN}${p.url}` }
    : LAWN.map((g) => ({ '@type': 'Offer', name: `${g.name} rental`, price: RATE.day, priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: `${DOMAIN}/rentals/#${g.slug}`,
      priceSpecification: { '@type': 'UnitPriceSpecification', price: RATE.day, priceCurrency: 'USD', unitCode: 'DAY' } }));
  return { '@context': 'https://schema.org', '@type': 'Service', name: p.serviceName, serviceType: p.serviceType, url: `${DOMAIN}${p.url}`,
    description: p.description.replace(/&amp;/g, '&'), provider: { '@id': `${DOMAIN}/#business`, '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, ...C.businessContactFields() },
    areaServed: areas, isRelatedTo: { '@type': 'Service', name: parent.name, url: `${DOMAIN}${parent.url}` }, offers: offer };
}

function breadcrumbJsonLd(p) {
  const parent = parentOf(p.parent);
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
    { '@type': 'ListItem', position: 2, name: parent.name, item: `${DOMAIN}${parent.url}` },
    { '@type': 'ListItem', position: 3, name: p.crumb, item: `${DOMAIN}${p.url}` }] };
}

module.exports = { PAGES, imagesFor, faqJsonLd, serviceJsonLd, breadcrumbJsonLd, parentOf, money, esc, DOMAIN, BUNDLES, LAWN };

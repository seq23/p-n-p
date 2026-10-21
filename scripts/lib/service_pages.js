'use strict';
/**
 * The four service pages (owner ruling 21 Oct 2026): the site has EXACTLY four services, and each
 * has one strong page that owns its Memphis searches.
 *
 *   porch    /services/porch-decorating            porch decorating memphis, fall/christmas porch decor
 *   party    /services/celebration-setups          party decorations, birthday decor, hotel room
 *                                                  decoration (#hotel-room-setups), balloon arch
 *   grazing  /services/grazing-and-event-styling   grazing table / charcuterie table memphis
 *   rentals  /rentals/                             lawn game rentals, giant yard games
 *                                                  (#giant-lawn-games), giant connect four
 *
 * Every price comes from data/offers/services.json, data/offers/porch_packages.json and
 * data/rentals/games.json; every FAQ answer is the owner-approved /faq/ answer
 * (scripts/lib/faq_content.js), so the service pages cannot contradict the FAQ, the pricing page
 * or the invoices. The AI pictures (Workers AI flux-1-schnell, free allowance) are registered one
 * by one, with their hash, in data/offers/service_ai_images.json.
 *
 * Who uses it: scripts/install_service_pages.js (the three hand-maintained pages),
 * scripts/generators/build_rentals_page.js (rentals), scripts/generators/build_area_pages.js
 * (links from all 32 city pages) and scripts/validators/validate_service_pages.js.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const PK = require(path.join(ROOT, 'data/offers/porch_packages.json'));
const AI = require(path.join(ROOT, 'data/offers/service_ai_images.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const RENTALS = INV.resolve(require(path.join(ROOT, 'data/rentals/games.json')));

const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const esc = (s) => String(s).replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const S = offers.services;
const PAY = offers.payment;
const TD = offers.addOns.takedown;
const TRAVEL = offers.travel;
const QUOTE = offers.quoteUrl;

const porchFrom = Math.min(...PK.seasons.flatMap((s) => Object.values(s.tiers).map((t) => t.from)));
const partyFrom = Number(String(S.celebration.price).replace(/[^0-9]/g, ''));
const grazeFrom = Math.min(...S.grazing.tiers.map((t) => t.from));
const games = INV.publicGames(RENTALS);
const extras = INV.publicExtras(RENTALS);
/** The yard games: every available game except tabletop ones (Grab the Mic is played at a table). */
/** The two focused landing pages inside the four services, out of the nav (scripts/lib/focus_pages.js). */
const FOCUS = { hotel: '/services/hotel-room-decor-memphis', lawn: '/rentals/giant-lawn-games-memphis' };
const lawnGames = games.filter((g) => g.use !== 'indoor' && !/tabletop/i.test(`${g.size} ${g.blurb}`));

/** The /faq/ answer to `q` in section `id`, verbatim (throws if the FAQ no longer has it). */
function faq(id, q, as) {
  const FAQ = require(path.join(ROOT, 'scripts/lib/faq_content.js'));
  const sec = FAQ.SECTIONS.find((s) => s.id === id);
  const hit = sec && sec.qa.find(([x]) => x === q);
  if (!hit) throw new Error(`service_pages: /faq/ section ${id} has no question "${q}"`);
  return [as || q, hit[1]];
}
const payQ = () => ['How do I pay?', `Your date is held by ${PAY.decorHold}, paid by ${PAY.methods} from your invoice. The rest is due ${PAY.decorBalanceDue}. ${PAY.methods} only; we do not take cash or cards.`];
const areaQ = () => ['What area do you serve?', TRAVEL.line];

const PAGES = [
  {
    key: 'porch', file: 'services/porch-decorating.html', url: '/services/porch-decorating', request: 'porch', area: 'porch-decorating',
    name: 'Porch decorating', from: porchFrom, fromText: `from ${money(porchFrom)}`,
    targets: ['porch decorating memphis', 'seasonal porch decor memphis', 'fall porch decor memphis', 'christmas porch decor memphis'],
    answer: `Porch &amp; Party decorates Memphis-area front porches for fall, Halloween, Thanksgiving and Christmas, with packages from ${money(porchFrom)}. We design it, bring everything and set it up (wreath, planters, pumpkins or greenery, lanterns and lights), and ${TD.line.charAt(0).toLowerCase()}${TD.line.slice(1)}`,
    sections: () => [
      { id: 'seasonal-porch-decor', h2: 'Fall, Halloween and Christmas porch decor in Memphis',
        body: `<p>Pick the season and the size: ${PK.tierOrder.map((t) => PK.tiers[t].name).join(', ')}. ${esc(PK.estimateLine)} ${esc(PK.bundle.line)}</p><p>${esc(faq('porch', 'Which seasons do you decorate?')[1])} ${esc(faq('porch', 'Will it hold up in weather?')[1])}</p>` },
    ],
    faq: () => [
      faq('porch', 'What does a porch setup include?'),
      faq('porch', 'How far ahead should I book a porch?'),
      faq('porch', 'Do I need to be home?', 'Do I need to be home for the setup?'),
      faq('porch', 'Do I keep the decor?', 'Do you take the decor down after the season?'),
      areaQ(),
      payQ(),
    ],
  },
  {
    key: 'party', file: 'services/celebration-setups.html', url: '/services/celebration-setups', request: 'party', area: 'party-decor',
    name: 'Party planning and decor', from: partyFrom, fromText: `from ${money(partyFrom)}`,
    title: 'Party Decorations &amp; Hotel Room Setups in Memphis | Porch &amp; Party',
    targets: ['party decorations memphis', 'birthday party decor memphis', 'hotel room decoration memphis', 'balloon arch memphis'],
    answer: `Porch &amp; Party plans and sets up party decorations in Memphis homes, hotel rooms and venues, from ${money(partyFrom)}: birthdays, anniversaries, proposals, showers and surprises. Balloon arches and garlands, backdrops, rose petals and candles and table styling, set up before your guests arrive.`,
    sections: () => [
      { id: 'hotel-room-setups', h2: 'Hotel Room Setups',
        body: `<p>Romantic, anniversary, proposal and birthday hotel room setups in Memphis, from ${money(partyFrom)}: rose petals and candles, balloons by the bed and a bouquet, ready before your person walks in.</p><p><a href="${FOCUS.hotel}" data-focus-link="hotel">See hotel room setups &rarr;</a></p>` },
      { id: 'party-decorations', h2: 'Birthday, shower and balloon arch decorations',
        body: `<p>Birthdays for every age, baby and bridal showers, welcome-home surprises and anniversaries at home or at a venue: balloon arches and garlands, backdrops, florals and table styling. To match a theme or colors, send a photo or a Pinterest link with your request. Setups start at ${money(partyFrom)}; the total depends on the size of the room, the pieces (balloons, backdrop, florals) and how many tables, so tell us your budget range on the form and we design to it.</p>` },
    ],
    faq: () => [
      faq('party', 'What do you set up?', 'What is included in a party setup?'),
      ['Do you decorate hotel rooms?', `Yes, and homes and venues too. ${faq('party', 'Home, hotel or venue?')[1].replace(/^All three\. /, '')}`],
      ['How far ahead should I book?', 'Two to three weeks ahead is comfortable for most birthdays, and earlier for weekends in spring and December.'],
      faq('party', 'How long does setup take?'),
      faq('party', 'What happens afterwards?', 'Do you take it down afterwards?'),
      areaQ(),
      payQ(),
    ],
  },
  {
    key: 'grazing', file: 'services/grazing-and-event-styling.html', url: '/services/grazing-and-event-styling', request: 'grazing', area: 'grazing-tables',
    name: 'Grazing tables', from: grazeFrom, fromText: `from ${money(grazeFrom)}`,
    title: 'Grazing &amp; Charcuterie Tables in Memphis | Porch &amp; Party',
    targets: ['grazing table memphis', 'charcuterie table memphis'],
    answer: `Porch &amp; Party styles grazing and charcuterie tables in Memphis from ${money(grazeFrom)} for a board, ${money(S.grazing.tiers[1].from)} for a small table and ${money(S.grazing.tiers[2].from)} for a full table. We bring the boards, risers and styling and lay out cheeses, charcuterie, fruit, breads and sweets; food is quoted separately at about ${money(S.grazing.foodPerHead.low)} to ${money(S.grazing.foodPerHead.high)} a guest.`,
    sections: () => [
      { id: 'grazing-table-sizes', h2: 'Grazing and charcuterie table sizes and prices',
        body: `<ul>${S.grazing.tiers.map((t) => `<li><strong>${esc(t.name)}</strong>: styling from ${money(t.from)}, feeds ${t.feedsSnack[0]} to ${t.feedsSnack[1]} as a snack or ${t.feedsMeal[0]} to ${t.feedsMeal[1]} as a meal.</li>`).join('')}</ul><p>${esc(S.grazing.notes.join(' '))}</p>` },
    ],
    faq: () => [
      faq('grazing', 'What is a grazing table?'),
      faq('grazing', 'Is food included?'),
      faq('grazing', 'How many people does a table feed?'),
      faq('booking', 'How do I book?', 'How far ahead should I book?'),
      faq('grazing', 'Do you bring the table and boards?'),
      areaQ(),
      payQ(),
    ],
  },
  {
    key: 'rentals', file: 'rentals/index.html', url: '/rentals/', request: 'rentals', area: 'party-game-rentals', generated: 'scripts/generators/build_rentals_page.js',
    name: 'Party game rentals', from: RENTALS.rates.day, fromText: `${money(RENTALS.rates.day)} a game per day`,
    targets: ['lawn game rentals memphis', 'giant yard games memphis', 'giant connect four rental memphis'],
    sections: () => [
      { id: 'giant-lawn-games', h2: 'Giant Lawn Games',
        body: `<p>Giant yard games for Memphis backyard parties, ${money(RENTALS.rates.day)} a game per day or ${money(RENTALS.rates.weekend)} for the weekend: ${esc(INV.joinAnd(lawnGames.map((g) => g.name)))}. Pick up and return at ${esc(RENTALS.pickup.place)}.</p><p><a href="${FOCUS.lawn}" data-focus-link="lawn">See giant lawn games &rarr;</a></p>` },
    ],
  },
];

/** The registered AI pictures for one page (data/offers/service_ai_images.json). */
/** An entry shows on its `page`, or on every page in `pages` (owner photos appear on several). */
const onPage = (i, key) => (i.pages || [i.page]).includes(key);
const imagesFor = (key) => AI.images.filter((i) => onPage(i, key));

/** "Book online" (owner ruling 21 Oct 2026) - the big primary button, preselecting the service. */
const bookHref = (svc) => (svc ? `${QUOTE}?service=${svc}` : QUOTE);
function bookButton(svc, where) {
  return `<a href="${bookHref(svc)}" class="btn-primary btn-book" data-book-online="${where}">Book online</a>`;
}

function gallery(key) {
  const imgs = imagesFor(key);
  return `<div class="service-gallery" data-service-gallery="${key}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:20px;">${imgs.map((i) => `<div class="card-media" style="border-radius:16px;overflow:hidden;"><img src="/${i.file}" alt="${esc(i.alt)}" width="${i.width || 1024}" height="${i.height || 768}" loading="lazy" decoding="async" style="width:100%;height:auto;display:block;"/></div>`).join('')}</div>`;
}

/** The body block every service page carries: subsections, pictures, FAQ, Book online again. */
function bodyBlock(p) {
  const faqs = p.faq ? p.faq() : [];
  const secs = p.sections().map((s) => `<div class="info-panel" id="${s.id}"><h2>${s.h2}</h2>${s.body}</div>`).join('');
  const faqHtml = faqs.length
    ? `<div class="answer-block" id="service-faq" style="margin-top:40px;"><span class="eyebrow">FAQ</span><h2>${esc(p.name)} questions</h2></div><div class="faq-list">${faqs.map(([q, a]) => `<div class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('')}</div>`
    : '';
  return `<!--service-page--><section class="section" data-service-page="${p.key}"><div class="container"><div class="content-stack">${secs}</div>${gallery(p.key)}${faqHtml}<div class="btn-row centered-cta-row" style="margin-top:24px;">${bookButton(p.request, 'after-faq')}<a href="/pricing" class="btn-secondary">See Pricing</a></div><p class="muted" style="text-align:center;">Request a Quote: pick your date on the booking form and we reply within one business day.</p></div></section><!--/service-page-->`;
}

/** The above-the-fold direct answer + Book online for a hand-maintained page's hero. */
function heroBlock(p) {
  // The answer <p> comes straight after the </h1> (the services hub takes it as the page's lead).
  return `<p class="service-answer" data-service-answer="${p.key}">${p.answer}</p><!--service-hero--><div class="btn-row">${bookButton(p.request, 'hero')}<a class="btn-secondary" href="/pricing">See Pricing</a></div><p class="muted book-online-line">Request a Quote: pick your date on the booking form and we reply within one business day.</p><!--/service-hero-->`;
}

function faqJsonLd(p) {
  const faqs = p.faq();
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
}

module.exports = { FOCUS, PAGES, onPage, imagesFor, bookButton, bookHref, gallery, bodyBlock, heroBlock, faqJsonLd, lawnGames, porchFrom, partyFrom, grazeFrom, money, esc, AI };

'use strict';
/**
 * The consolidated FAQ (owner-approved 2026-10-17): one page, /faq/, sectioned
 * by service, with a grazing estimator and the Price my porch calculator. Every number
 * comes from data/offers/services.json, data/offers/porch_packages.json, data/service_areas/areas.json and
 * data/rentals/games.json, so the FAQ cannot contradict the pages or invoices
 * (scripts/validators/validate_faq_page.js holds it to that).
 *
 * The rentals questions are the same array the rentals page renders
 * (scripts/generators/build_rentals_page.js FAQ), so the two never drift.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const areas = require(path.join(ROOT, 'data/service_areas/areas.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const games = INV.resolve(require(path.join(ROOT, 'data/rentals/games.json')));
const HAS_SCREEN = INV.publicExtras(games).some((x) => x.slug === 'inflatable-movie-screen');
const porchPackages = require(path.join(ROOT, 'data/offers/porch_packages.json'));
const PP = require(path.join(ROOT, 'scripts/lib/porch_packages.js'));
const { FAQ: RENTALS_FAQ } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));

const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const S = offers.services;
const TD = offers.addOns.takedown;
const PAY = offers.payment;
const TRAVEL = offers.travel;
const PICK = games.pickup;
const cities = areas.areas.map((a) => a.split(',')[0]);
const cityList = `${cities.slice(0, -1).join(', ')} and ${cities[cities.length - 1]}`;
const grazingTiers = S.grazing.tiers;
const food = S.grazing.foodPerHead;
const feeds = (t) => `${t.feedsSnack[0]} to ${t.feedsSnack[1]}`;
const meal = (t) => `${t.feedsMeal[0]} to ${t.feedsMeal[1]}`;
const [board, small, full, extra] = grazingTiers;

const SECTIONS = [
  {
    id: 'booking', title: 'Booking & payment', eyebrow: 'Every service',
    lead: 'How to book, what holds your date, and how you pay.',
    intro: 'How a booking works, what holds your date, and how you pay. These apply to porches, party and room decor, grazing tables and rentals.',
    qa: [
      ['How do I book?',
        'Fill in the quote form; it takes about three minutes. We reply within one business day with what is open on your date and the total. Nothing is held until the deposit is in.'],
      ['What holds my date?',
        `Porch, party and room decor and grazing tables: ${PAY.decorHold}. Rentals: a ${money(games.damageDeposit)} refundable damage deposit plus ${games.holdPercent}% of the rental. Both are paid by ${PAY.methods} from your invoice.`],
      ['When is the rest due?',
        `Porch, decor and grazing: ${PAY.decorBalanceDue}. Rentals: at pickup, by ${PAY.methods} on the spot.`],
      ['Do you take cash or cards?',
        `No. ${PAY.methods} only, so every payment has a record on both sides.`],
      ['Can I cancel or move my date?',
        `Cancel ${PAY.cancelFreeHours} hours or more before and the deposit comes back in full. Inside ${PAY.cancelFreeHours} hours the deposit is kept. Rain or a storm moves your date free within ${PAY.weatherRescheduleDays} days.`],
      ['Why do you ask for a photo ID?',
        'It confirms the person booking is the person we meet. It is used for that only and deleted after your event.'],
      ['How far do you travel?',
        `${TRAVEL.line} Rentals are picked up and returned at ${PICK.place}, so no travel applies to them.`],
      ['Where do your prices start?',
        `${S.porch.name} from ${S.porch.price}, ${S.celebration.name} from ${S.celebration.price}, ${S.grazing.name} from ${S.grazing.price}, and party game rentals at ${money(games.rates.day)} a game a day. The exact quote depends on size, date, location and materials.`]
    ]
  },
  {
    id: 'porch', title: 'Porch decor', eyebrow: S.porch.name,
    lead: `Seasonal front-porch styling from ${S.porch.price}.`,
    intro: `Seasonal front-porch styling from ${S.porch.price}, priced by package: ${PP.tierKeys(porchPackages).map((t) => porchPackages.tiers[t].name).join(', ')}, for fall and for Christmas. Pick the season and the look closest to what you want for a starting price. ${porchPackages.bundle.line}`,
    picker: 'porch',
    qa: [
      ['What does a porch setup include?',
        'We design it, bring everything and set it up: wreath, door swag, planters, pumpkins or greenery, lanterns, signs and lights to suit the season. You come home to a finished porch.'],
      ['How much does a porch cost?',
        `${porchPackages.seasons.map((x) => `${x.name}: ${PP.tierKeys(porchPackages).map((t) => `${porchPackages.tiers[t].name} from ${money(x.tiers[t].from)}`).join(', ')}.`).join(' ')} ${porchPackages.bundle.line} ${porchPackages.estimateLine}`],
      ['Which porch package do I need?',
        `${porchPackages.sizeHint} ${porchPackages.seasons[0].customLine}`],
      ['What add-ons can I ask for?',
        `${porchPackages.addOns.line} We price add-ons with your quote.`],
      ['Which seasons do you decorate?',
        'Fall, Halloween, Thanksgiving and Christmas now; spring and special-occasion porches on request.'],
      ['Do I need to be home?',
        'No. We can work from the street side with your okay. Christmas lights that need an outlet need the outlet switched on.'],
      ['Do I keep the decor?',
        `Yes, everything we install is yours to keep. If you want it gone after the season, ${TD.line.charAt(0).toLowerCase()}${TD.line.slice(1)}`],
      ['Will it hold up in weather?',
        'Pumpkins, faux florals and lanterns are chosen to sit outside for the season. Real mums need watering; we tell you how much.'],
      ['How far ahead should I book a porch?',
        'Two to three weeks for fall and Christmas. Halloween and the week before Thanksgiving fill first.']
    ]
  },
  {
    id: 'party', title: 'Party & room decor', eyebrow: S.celebration.name,
    lead: `Birthdays, proposals, showers and hotel-room surprises from ${S.celebration.price}.`,
    intro: `Birthdays, anniversaries, proposals, showers and hotel-room surprises from ${S.celebration.price}, at your home, a hotel or a venue.`,
    qa: [
      ['What do you set up?',
        'Birthdays, anniversaries, proposals, baby and bridal showers, welcome-home surprises, hotel-room surprises and parties with a grazing table. Balloon arches and garlands, backdrops, rose petals and candles, table styling and signs.'],
      ['Home, hotel or venue?',
        'All three. For a hotel we coordinate access with the front desk or with you; for a venue we need their setup window.'],
      ['How much does party or room decor cost?',
        `From ${S.celebration.price}. The total depends on the size of the room, the pieces (balloons, backdrop, florals) and how many tables. Tell us your budget range on the form and we design to it.`],
      ['Can you match a theme or colors?',
        'Yes. Send a photo or a Pinterest link with your request.'],
      ['How long does setup take?',
        'One to three hours depending on the setup. We arrive early enough to be gone before guests, or before your person walks in.'],
      ['What happens afterwards?',
        `You keep it, or we come back for takedown. ${TD.line}`],
      ['Do you do the food too?',
        `${S.grazing.notes[0]} ${S.grazing.notes[1]} Or we style food you have ordered.`]
    ]
  },
  {
    id: 'grazing', title: 'Grazing tables', eyebrow: S.grazing.name,
    lead: `Styled grazing spreads from ${S.grazing.price} for the styling.`,
    intro: `Styled spreads of cheeses, charcuterie, fruit, breads, dips and sweets, from ${S.grazing.price} for the styling. Use the estimator for the size you need.`,
    estimator: 'grazing',
    qa: [
      ['What is a grazing table?',
        `A long spread of cheeses, charcuterie, fruit, breads, dips and sweets, styled so guests help themselves. Ours start at ${money(board.from)} for the styling of a board.`],
      ['Is food included?',
        `${S.grazing.notes[0]} ${S.grazing.notes[1]} Or we style food you have ordered. Your quote shows setup and styling on one line and food, if we source it, as a separate rough estimate.`],
      ['How many people does a table feed?',
        `As a snack with drinks: a board for ${feeds(board)}, a small table for ${feeds(small)}, a full table for ${feeds(full)}, and each additional table for about ${full.feedsSnack[0]} more. As the meal, roughly half: a board for ${meal(board)}, a small table for ${meal(small)}, a full table for ${meal(full)}.`],
      ['How much does the styling cost?',
        `Board from ${money(board.from)}, ${small.name.toLowerCase()} from ${money(small.from)}, ${full.name.toLowerCase()} from ${money(full.from)}, ${extra.name.toLowerCase()} from ${money(extra.from)}. Food is separate.`],
      ['How much does the food cost?',
        `${food.line} As a rough guide, about ${money(food.low)} to ${money(food.high)} a head.`],
      ['Allergies and dietary needs?',
        'Tell us on the form. Nut-free, vegetarian and halal selections are normal, and we label the table.'],
      ['How long does it keep?',
        'About two to three hours out at room temperature. For longer events we set up in two waves.'],
      ['Do you bring the table and boards?',
        'We bring boards, risers and the styling. The table itself is yours or the venue’s; tell us the size.']
    ]
  },
  {
    id: 'rentals', title: 'Party game rentals', eyebrow: 'Rentals',
    lead: `Giant yard games${HAS_SCREEN ? ' and a movie screen' : ''}, ${money(games.rates.day)} a game a day.`,
    intro: `${INV.rentalsPhrase(games, { games: 'Giant yard games' })}, ${money(games.rates.day)} a game a day, picked up and returned at ${PICK.place}. The same answers are on the rentals page.`,
    qa: [
      ...RENTALS_FAQ,
      ['Is this a sale?',
        'No. Everything on the rentals page is rental only and comes back to us after your event.']
    ]
  }
];

const flat = () => SECTIONS.flatMap((s) => s.qa);

module.exports = { SECTIONS, flat, porchPackages, grazingTiers, food, cityList, money };

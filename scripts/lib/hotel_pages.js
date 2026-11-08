'use strict';
/**
 * The hotel room setups search blitz (owner approval 8 Nov 2026): seven pages under the hotel
 * room setups hub (/services/hotel-room-decor-memphis), rendered with the focused-page template
 * by scripts/generators/build_focus_pages.js. The three question pages that go with them
 * (/questions/how-many-rose-petals-for-a-hotel-room, /questions/can-you-use-rose-petals-and-
 * candles-in-a-hotel, /questions/how-to-set-up-a-hotel-room-for-a-romantic-night) are written by
 * hand in the search-loop question-page format; QUESTIONS below lists them so the hub links them
 * and the validator holds them.
 *
 * Owner facts (8 Nov 2026), and nothing else:
 *   - Basic $300 / Luxury $500 / Signature $1,500 apply to hotel rooms, as "starting at" prices
 *     (the room setup presets in data/offers/services.json, never retyped here).
 *   - LED candles only, never an open flame. Hotel takedown is optional, $75.
 *   - We are usually there 3 to 6 PM, around check-in; the hotel can be left blank on /request
 *     (scripts/lib/party_pricing.js HOTEL_WINDOW / LOCATION_LATER).
 *   - "Many local hotels, from mid-range to luxury". Never a hotel we worked at, never a
 *     customer's name, face or house number, never "insured", "licensed" or a guarantee.
 *   - Only her real photos (data/offers/service_ai_images.json, source "owner"), tagged
 *     "Our real setup".
 * Every page offers the done-for-you setup twice (owner ruling 8 Nov 2026): right after the
 * answer and again at the end (build_focus_pages.js doneForYou()).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));
const PARTY = require(path.join(ROOT, 'scripts/lib/party_pricing.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));

const { money, esc } = SP;
const HUB = SP.FOCUS.hotel;
const PRESETS = offers.services.celebration.roomSetupPresets;
const preset = (key) => {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`hotel_pages: no room setup preset "${key}" in data/offers/services.json`);
  return p;
};
const BASIC = preset('basic');
const LUXURY = preset('luxury');
const SIGNATURE = preset('signature');
const TAKEDOWN = offers.addOns.takedown.fromPrice;
const CITIES = require(path.join(ROOT, 'data/service_areas/areas.json')).areas.map((a) => String(a.name || a).replace(/, (TN|MS)$/, ''));
const cityList = () => `${CITIES.slice(0, -1).join(', ')} and ${CITIES[CITIES.length - 1]}`;
const REQUEST = `${SP.bookHref('party')}#request-form`;
const PRICE_TOOL = '/pricing#price-my-party-room';

const PHOTO = {
  birthday: 'assets/img/celebrations/owner-birthday-bedroom.webp',
  hallway: 'assets/img/celebrations/owner-rose-petal-hallway.webp',
  anniversary: 'assets/img/celebrations/owner-anniversary-fireplace.webp',
  romantic: 'assets/img/celebrations/owner-romantic-bedroom-homepage.webp',
};

// ---- shared, data-backed pieces (each page words its own sections; these are facts only).
const basicIncludes = () => BASIC.lines[0].description.replace(/^Basic room setup \(/, '').replace(/\)$/, '');
function packagesTable() {
  const rows = [
    [BASIC, `${basicIncludes()}.`],
    [LUXURY, 'A styled balloon display and floating ceiling balloons, LED candle styling, rose-petal walkway and bed, and personal touches like a sign or lettering.'],
    [SIGNATURE, 'A grand balloon installation and a full balloon ceiling, floral arrangements, 40+ LED pillar and votive candles, and takedown included.'],
  ];
  return `<div class="table-wrap"><table class="compare-table"><thead><tr><th scope="col">Package</th><th scope="col">Starting at</th><th scope="col">What it looks like</th></tr></thead><tbody>${rows.map(([p, d]) => `<tr><th scope="row">${esc(p.name)}</th><td>${money(p.total)}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div>`;
}
const packagesLine = () => `${BASIC.name} starts at ${money(BASIC.total)}, ${LUXURY.name} at ${money(LUXURY.total)} and ${SIGNATURE.name} at ${money(SIGNATURE.total)}`;
const windowLine = () => `We are usually at the hotel between 3 and 6 PM, around check-in time, and gone before your person walks in.`;
const ledLine = () => 'We use LED candles only, never an open flame, so nothing sets off a smoke detector or breaks a hotel rule.';
const takedownLine = () => `Takedown is optional: for a hotel room it is ${money(TAKEDOWN)}, and it is included with ${SIGNATURE.name}.`;
const hotelsLine = () => 'We decorate at many local hotels, from mid-range to luxury, and we are not affiliated with any of them: you book the room, we bring everything and set it up.';
const blankHotel = () => 'No hotel booked yet? Leave the hotel blank on the request form and text it to us once you have it.';

// ---- the seven template pages.
const base = { parent: 'hotel', request: 'party', areaService: 'party-decor', from: SP.partyFrom, kind: 'service', serviceType: 'Hotel room decoration', family: 'hotel' };

const PAGES = [
  {
    ...base,
    key: 'hotel-anniversary', file: 'services/anniversary-hotel-room-setup-memphis.html', url: '/services/anniversary-hotel-room-setup-memphis',
    title: 'Anniversary Hotel Room Setup in Memphis | Porch &amp; Party',
    description: `An anniversary hotel room setup in Memphis, ready before you walk in: rose petals, LED candles, balloons and a sign. ${packagesLine()}.`,
    eyebrow: 'Anniversary Hotel Room', h1: 'Anniversary hotel room setup in Memphis', crumb: 'Anniversary Hotel Room Setup',
    targets: ['anniversary hotel room setup memphis', 'anniversary hotel room decorations', 'anniversary room decor memphis'],
    answer: `An anniversary hotel room setup is a hotel room Porch &amp; Party decorates for your anniversary before the two of you check in: a rose-petal heart on the bed, LED candles, balloons and a "Happy Anniversary" sign. In Memphis, setups start at ${money(BASIC.total)}, and we are usually there between 3 and 6 PM.`,
    serviceName: 'Anniversary hotel room setup in Memphis',
    images: [PHOTO.anniversary, PHOTO.romantic, PHOTO.hallway],
    faqH2: 'What do people ask about anniversary hotel room setups?',
    sections: () => [
      { id: 'what-is-included', h2: 'What goes into an anniversary hotel room setup?',
        body: `<p>A petal walkway from the door, a heart on the bed, a glow of LED candles and balloons in your colors. Most couples add one thing that is just theirs: the year you met on a balloon, your wedding colors, or "Happy 10th" in gold letters.</p><ul><li>Rose-petal walkway and bed design</li><li>LED tea lights or pillar candles (never an open flame)</li><li>Ceiling balloons, a garland or a balloon arch</li><li>A banner, lettering or marquee-style sign</li><li>Florals on the nightstands with ${SIGNATURE.name}</li></ul>` },
      { id: 'packages', h2: 'How much does an anniversary hotel room setup cost?',
        body: `<p>${packagesLine()}. These are starting prices; your quote depends on the room and how full you want it.</p>${packagesTable()}<p>${takedownLine()}</p>` },
      { id: 'timing', h2: 'When do you set up, and how do you get into the room?',
        body: `<p>${windowLine()} You check in, leave the key at the front desk or meet us, and go to dinner. We set up in one to three hours and text you when the room is ready.</p><p>${blankHotel()}</p>` },
      { id: 'milestones', h2: 'Ideas for milestone anniversaries',
        body: '<ul><li><strong>1st:</strong> keep it classic: red petals, white candles, one gold "1".</li><li><strong>5th and 10th:</strong> number balloons over the headboard and a photo display of your year.</li><li><strong>25th:</strong> silver and white balloons with a fuller ceiling.</li><li><strong>50th:</strong> gold, florals and a sign big enough for the family photo.</li></ul><p>Send a photo or a Pinterest link with your request and we match it.</p>' },
    ],
    faq: () => [
      ['How far ahead should I book an anniversary hotel room setup?', 'Two to three weeks ahead is comfortable for most anniversaries. Weekends in February, spring and December fill first, so book earlier for those. If your date is close, send the request anyway and we will tell you within one business day.'],
      ['Do you use real candles?', 'No. We use LED candles only, never an open flame. They look warm in photos, they are safe to leave on while you are at dinner, and they keep you clear of hotel smoke-detector and fire rules.'],
      ['Can you decorate the room before we check in?', `We set up after check-in, usually between 3 and 6 PM. You check in, arrange access with the front desk or meet us at the room, and we are gone before you come back. Porch & Party is not affiliated with any hotel.`],
      ['What happens to the decor afterwards?', `You keep it, or we come back for takedown. For a hotel room takedown is optional and ${money(TAKEDOWN)}, and it is included with ${SIGNATURE.name}.`],
      ['How do I pay?', `Your date is held by ${offers.payment.decorHold}, paid by ${offers.payment.methods} from your invoice. The rest is due ${offers.payment.decorBalanceDue}.`],
    ],
  },
  {
    ...base,
    key: 'hotel-birthday-him', file: 'services/birthday-hotel-room-decorations-for-him-memphis.html', url: '/services/birthday-hotel-room-decorations-for-him-memphis',
    title: 'Birthday Hotel Room Decorations for Him in Memphis | Porch &amp; Party',
    description: `Birthday hotel room decorations for him or your boyfriend in Memphis: black and gold balloons, his number, LED candles, set up before he walks in. From ${money(BASIC.total)}.`,
    eyebrow: 'Birthday Room for Him', h1: 'Birthday hotel room decorations for him in Memphis', crumb: 'Birthday Room for Him',
    targets: ['birthday hotel room decorations for him', 'birthday hotel room decorations for boyfriend', 'hotel room birthday surprise for him memphis'],
    answer: `Birthday hotel room decorations for him are a hotel room Porch &amp; Party sets up for your boyfriend's or husband's birthday before he walks in: balloons in his colors, his age in big numbers, a banner, LED candles and a styled bed. In Memphis, setups start at ${money(BASIC.total)}.`,
    serviceName: 'Birthday hotel room decorations for him in Memphis',
    images: [PHOTO.birthday, PHOTO.hallway, PHOTO.anniversary],
    faqH2: 'What do people ask about a birthday hotel room for him?',
    sections: () => [
      { id: 'looks-he-likes', h2: 'What does a birthday hotel room for him look like?',
        body: '<p>Bold and simple works best. Pick two colors he would actually wear and we build the room around them.</p><ul><li><strong>Black and gold:</strong> the most asked-for look, with gold number balloons over the headboard.</li><li><strong>Red and black:</strong> his team colors, or a classic romantic room with a birthday banner.</li><li><strong>Navy, silver and white:</strong> clean and grown-up.</li><li><strong>His thing:</strong> a sports, gaming or music theme in his colors.</li></ul>' },
      { id: 'what-is-included', h2: 'What is included?',
        body: `<p>Our ${BASIC.name} setup includes ${esc(basicIncludes())}. ${LUXURY.name} adds a styled balloon display, more candles and personal touches like lettering; ${SIGNATURE.name} fills the room, with a balloon installation, a balloon ceiling and florals.</p>${packagesTable()}` },
      { id: 'surprise-plan', h2: 'How do you keep it a surprise?',
        body: `<ol><li>You book the room and send us the date, the colors and his age.</li><li>${windowLine()}</li><li>You take him out (dinner, a game, Beale Street) while we finish.</li><li>We text you a photo when it is ready, and you bring him back.</li></ol><p>${blankHotel()}</p>` },
      { id: 'add-ons', h2: 'Can I add gifts, a cake or drinks?',
        body: `<p>Yes: leave his gifts, a cake or a bottle with us at setup and we style them into the room. ${ledLine()} ${takedownLine()}</p>` },
    ],
    faq: () => [
      ['How much are birthday hotel room decorations for him?', `${packagesLine()}. These are starting prices; we quote your exact room once we know the look and the hotel.`],
      ['Can you put his age in balloons?', 'Yes. Big gold, silver or black number balloons are part of most of our birthday rooms. Tell us his age and colors on the request form.'],
      ['When do you set up?', 'Usually between 3 and 6 PM, around check-in. One to three hours for most rooms, and we are gone before he walks in.'],
      ['Do I need to have the hotel booked first?', 'No. You can leave the hotel blank on the request form and text it to us once you have booked. We decorate at many local hotels, from mid-range to luxury.'],
      ['Do you take it down?', `You keep it, or we come back for takedown: optional, ${money(TAKEDOWN)} for a hotel room, and included with ${SIGNATURE.name}.`],
    ],
  },
  {
    ...base,
    key: 'hotel-birthday-her', file: 'services/birthday-hotel-room-decorations-for-her-memphis.html', url: '/services/birthday-hotel-room-decorations-for-her-memphis',
    title: 'Birthday Hotel Room Decorations for Her in Memphis | Porch &amp; Party',
    description: `Birthday hotel room decorations for her or your girlfriend in Memphis: balloons, rose petals, LED candles and her number, ready before she walks in. From ${money(BASIC.total)}.`,
    eyebrow: 'Birthday Room for Her', h1: 'Birthday hotel room decorations for her in Memphis', crumb: 'Birthday Room for Her',
    targets: ['birthday hotel room decorations for her', 'birthday hotel room decorations for girlfriend', 'hotel room birthday surprise for her memphis'],
    answer: `Birthday hotel room decorations for her are a hotel room Porch &amp; Party sets up for your girlfriend's or wife's birthday before she sees it: balloons in her colors, rose petals on the bed, LED candles, her number and a banner. In Memphis, setups start at ${money(BASIC.total)}.`,
    serviceName: 'Birthday hotel room decorations for her in Memphis',
    images: [PHOTO.birthday, PHOTO.romantic, PHOTO.hallway],
    faqH2: 'What do people ask about a birthday hotel room for her?',
    sections: () => [
      { id: 'looks-she-likes', h2: 'What does a birthday hotel room for her look like?',
        body: '<p>Pick her colors and we build around them. The looks we are asked for most:</p><ul><li><strong>Pink, white and gold:</strong> soft, bright and great in photos.</li><li><strong>Red and black:</strong> a romantic room with a birthday banner and her number in gold.</li><li><strong>All white with florals:</strong> clean and elegant.</li><li><strong>Her favorite:</strong> send a Pinterest link and we match it.</li></ul>' },
      { id: 'what-is-included', h2: 'What is included?',
        body: `<p>Our ${BASIC.name} setup includes ${esc(basicIncludes())}. ${LUXURY.name} adds a styled balloon display, more candles and personal touches; ${SIGNATURE.name} is the full room, with a balloon installation she can stand in front of for photos, a balloon ceiling and florals.</p>${packagesTable()}` },
      { id: 'photo-moment', h2: 'How do I make it photo-ready?',
        body: '<p>Give her one wall for pictures. A balloon arch or garland over the headboard with her number and a banner makes the shot; candles and petals on the bed fill the frame. Tell us where the window and the bed are once you have the room and we plan the photo spot.</p>' },
      { id: 'timing', h2: 'When do you set up, and how does she not find out?',
        body: `<p>${windowLine()} You check in, give the front desk our name or meet us at the room, and take her out while we work. We text you when it is ready. ${blankHotel()}</p><p>${ledLine()} ${takedownLine()}</p>` },
    ],
    faq: () => [
      ['How much are birthday hotel room decorations for her?', `${packagesLine()}. These are starting prices; the exact quote depends on the room and how full you want it.`],
      ['Can you add flowers?', `Yes. Florals come with ${SIGNATURE.name}, and we can add a bouquet to any setup. Tell us her favorite flowers and colors on the request form.`],
      ['Do you use rose petals and candles?', 'Yes: rose petals on the bed and a walkway, and LED candles only. We never use an open flame in a hotel room.'],
      ['When do you set up?', 'Usually between 3 and 6 PM, around check-in. Most rooms take one to three hours, and we are gone before she walks in.'],
      ['Do I need to book the hotel first?', 'No. Leave the hotel blank on the request form and text it to us once you have it. We decorate at many local hotels, from mid-range to luxury.'],
    ],
  },
  {
    ...base,
    key: 'hotel-proposal', file: 'services/proposal-hotel-room-setup-memphis.html', url: '/services/proposal-hotel-room-setup-memphis',
    title: 'Proposal Hotel Room Setup in Memphis | Porch &amp; Party',
    description: `A proposal hotel room setup in Memphis: a rose-petal path, LED candles, a "Marry Me" sign and balloons, ready before you walk in together. ${packagesLine()}.`,
    eyebrow: 'Proposal Hotel Room', h1: 'Proposal hotel room setup in Memphis', crumb: 'Proposal Hotel Room Setup',
    targets: ['proposal hotel room setup memphis', 'hotel room proposal decorations', 'proposal room decor memphis'],
    answer: `A proposal hotel room setup is a hotel room Porch &amp; Party decorates for the moment you ask: a rose-petal path from the door, LED candles everywhere, a "Marry Me" sign and balloons, all ready before you walk in together. In Memphis, setups start at ${money(BASIC.total)}, set up between 3 and 6 PM.`,
    serviceName: 'Proposal hotel room setup in Memphis',
    images: [PHOTO.hallway, PHOTO.romantic, PHOTO.anniversary],
    faqH2: 'What do people ask about a proposal hotel room setup?',
    sections: () => [
      { id: 'the-setup', h2: 'What does a proposal hotel room setup include?',
        body: '<ul><li>A rose-petal path from the door to where you will ask</li><li>LED candles along the path and around the room</li><li>A "Marry Me" sign or marquee-style letters</li><li>Balloons in white, red or gold, and a petal heart on the bed</li><li>A spot for the photo, planned around the window and the light</li></ul><p>Tell us where in the room you want to kneel and we build the room toward it.</p>' },
      { id: 'packages', h2: 'How much does a proposal hotel room setup cost?',
        body: `<p>${packagesLine()}. A proposal usually sits in ${LUXURY.name} or ${SIGNATURE.name}, because the candles and the sign do most of the work.</p>${packagesTable()}` },
      { id: 'plan-the-day', h2: 'How do I plan the day so it stays a secret?',
        body: `<ol><li>Book the room and send us your date and colors. ${blankHotel()}</li><li>Check in early and arrange access with the front desk, or meet us at the room.</li><li>Take them to dinner. ${windowLine()}</li><li>We text you a photo when it is ready. Walk in, and ask.</li></ol>` },
      { id: 'after', h2: 'What happens after the yes?',
        body: `<p>Stay the night in it. ${ledLine()} ${takedownLine()}</p>` },
    ],
    faq: () => [
      ['Will you be there when I propose?', 'No. We finish the room and leave before you arrive, so the moment is just the two of you. We text you a photo when it is ready.'],
      ['Can you write our names or a message?', 'Yes. A "Marry Me" sign is the classic; we can also do lettering, a banner or your names. Tell us on the request form.'],
      ['Are the candles real?', 'No. We use LED candles only, never an open flame. They look real in photos and keep you inside hotel fire and smoke-detector rules.'],
      ['How far ahead should I book?', 'Two to three weeks is comfortable; earlier for Valentine\'s Day, Christmas and New Year\'s Eve weekends. If your date is sooner, send the request and we will tell you within one business day.'],
      ['Do you take it down?', `You keep it, or we come back for takedown: optional, ${money(TAKEDOWN)} for a hotel room, and included with ${SIGNATURE.name}.`],
    ],
  },
  {
    ...base,
    key: 'hotel-valentines', file: 'services/valentines-day-hotel-room-setup-memphis.html', url: '/services/valentines-day-hotel-room-setup-memphis',
    title: 'Valentine\'s Day Hotel Room Setup in Memphis | Porch &amp; Party',
    description: `A Valentine's Day hotel room setup in Memphis: red rose petals, LED candles, heart balloons, ready by check-in. Book early; ${packagesLine()}.`,
    eyebrow: 'Valentine\'s Day Hotel Room', h1: 'Valentine\'s Day hotel room setup in Memphis', crumb: 'Valentine\'s Day Hotel Room',
    targets: ['valentines day hotel room setup memphis', 'valentines hotel room decorations', 'valentines room decor memphis'],
    answer: `A Valentine's Day hotel room setup is a hotel room Porch &amp; Party decorates for February 14: red rose petals, LED candles, heart balloons and a sign, ready before you walk in. In Memphis, setups start at ${money(BASIC.total)}, set up between 3 and 6 PM; book early, because the dates around Valentine's Day fill first.`,
    serviceName: 'Valentine\'s Day hotel room setup in Memphis',
    images: [PHOTO.romantic, PHOTO.hallway, PHOTO.anniversary],
    faqH2: 'What do people ask about a Valentine\'s Day hotel room?',
    sections: () => [
      { id: 'book-early', h2: 'When should I book a Valentine\'s Day hotel room setup?',
        body: '<p>As early as you can, ideally in January. Every couple wants the same evening, and each setup needs our 3 to 6 PM check-in window, so we can only do so many rooms on February 13, 14 and 15. The weekend nearest Valentine\'s Day goes first.</p>' },
      { id: 'the-look', h2: 'What does a Valentine\'s Day room look like?',
        body: '<ul><li>Red rose petals: a walkway and a heart on the bed</li><li>LED candles on every surface (never an open flame)</li><li>Red, pink, white or gold heart balloons and a ceiling of balloons</li><li>A "Be Mine", "I Love You" or names sign</li><li>Room for chocolates, a bottle or gifts you leave with us</li></ul>' },
      { id: 'packages', h2: 'How much is a Valentine\'s Day hotel room setup?',
        body: `<p>${packagesLine()}; the same starting prices as any other day.</p>${packagesTable()}<p>${takedownLine()}</p>` },
      { id: 'timing', h2: 'How does setup work on the day?',
        body: `<p>${windowLine()} You check in and arrange access with the front desk or meet us at the room; we text you a photo when it is ready. ${blankHotel()}</p>` },
    ],
    faq: () => [
      ['How far ahead should I book for Valentine\'s Day?', 'Book in January if you can. We set up in the 3 to 6 PM check-in window, so there is room for only so many setups on the days around February 14, and the nearest weekend fills first.'],
      ['Is Valentine\'s Day more expensive?', `No. ${packagesLine()}, the same starting prices as any other day.`],
      ['Do you use real candles or real petals?', 'Rose petals, yes. Candles are LED only, never an open flame, so the room stays inside hotel rules and you can leave them glowing while you are out.'],
      ['Can I leave gifts or chocolates for you to set out?', 'Yes. Leave them with us at setup and we style them into the room.'],
      ['What if I have not booked the hotel yet?', 'Leave the hotel blank on the request form and text it to us once you book. We decorate at many local hotels, from mid-range to luxury.'],
    ],
  },
  {
    ...base,
    kind: 'guide', serviceType: 'Hotel room decoration',
    key: 'hotel-jacuzzi', file: 'guides/memphis-hotels-with-jacuzzi-in-room.html', url: '/guides/memphis-hotels-with-jacuzzi-in-room',
    title: 'Romantic Memphis Hotels With an In-Room Jacuzzi | Porch &amp; Party',
    description: 'Romantic Memphis-area hotels with an in-room jacuzzi or whirlpool tub, each checked on the hotel\'s own website, and how to set the room up for a night away.',
    eyebrow: 'Memphis Guide', h1: 'Romantic Memphis hotels with an in-room jacuzzi', crumb: 'Hotels With an In-Room Jacuzzi',
    targets: ['memphis hotels with jacuzzi in room', 'romantic hotels with jacuzzi memphis', 'hotel with jacuzzi in room memphis tn'],
    answer: 'A Memphis hotel with an in-room jacuzzi is one that sells a room or suite with its own whirlpool, jetted or air tub, not just a shared hot tub by the pool. Three Memphis-area hotels list one on their own websites (checked 8 November 2026): Big Cypress Lodge, Courtyard Memphis East/Bill Morris Parkway and Hampton Inn &amp; Suites Millington.',
    serviceName: 'Romantic Memphis hotels with an in-room jacuzzi',
    images: [PHOTO.romantic, PHOTO.hallway, PHOTO.anniversary],
    faqH2: 'What do people ask about Memphis hotels with a jacuzzi?',
    sections: () => [
      { id: 'the-list', h2: 'Which Memphis hotels have a jacuzzi in the room?',
        body: `<p>Each of these lists a room with its own tub on the hotel's own website. Porch &amp; Party is not affiliated with any of them, and this list does not mean we have worked there. Rooms, names and prices change, so confirm the exact room when you book.</p><ul class="hotel-jacuzzi-list">${JACUZZI.map((h) => `<li><strong>${esc(h.name)}</strong> (${esc(h.area)}): ${esc(h.room)}. <a href="${h.source}" rel="noopener nofollow" target="_blank">The hotel's room page</a> <span class="muted">(checked ${h.checkedLabel})</span></li>`).join('')}</ul>` },
      { id: 'how-to-book', h2: 'How do I make sure I get the jacuzzi room?',
        body: '<ol><li>Book the named room type directly, not "run of house" or "king, any".</li><li>Call the hotel after booking and ask them to note "whirlpool room confirmed" on your reservation.</li><li>Ask whether the tub is in the bedroom or the bathroom, which changes where the candles and petals go.</li><li>Check in as early as the hotel allows if you want the room decorated before dinner.</li></ol>' },
      { id: 'not-on-the-list', h2: 'Why isn\'t my favorite hotel on the list?',
        body: '<p>We only list a hotel when its own website shows a room with a whirlpool, jetted or air tub. Several well-known Memphis hotels have a pool hot tub or a deep soaking tub but no jetted tub in the room, and some sites would not show room details when we checked. If a hotel tells you it has one, it may well be right: ask for the exact room name.</p>' },
      { id: 'set-up-the-room', h2: 'How do you decorate a jacuzzi room?',
        body: `<p>Petals on the bed and a path to the tub, LED candles around the tub ledge and the sink, and balloons kept away from the water. ${ledLine()} ${hotelsLine()}</p><p>${packagesLine()}. ${windowLine()}</p>` },
    ],
    faq: () => [
      ['Does the Peabody have jacuzzi rooms?', 'The Peabody\'s own rooms page describes marble bathrooms and lists a jacuzzi with the shared athletic club and pool, not inside the guest rooms, when we checked on 8 November 2026. Ask the hotel directly if you want a tub in the room.'],
      ['Is an air tub the same as a jacuzzi?', 'Close. "Jacuzzi" is a brand that became the everyday word for any jetted tub. A whirlpool tub pushes water through jets; an air tub pushes air bubbles. Both give you a bubbling bath in your own room.'],
      ['Can you put rose petals in the jacuzzi?', 'Petals on top of the water look great in photos, but they can clog jets and filters. Float them in the tub only with the jets off, and scoop them out before you turn the jets on.'],
      ['Can you decorate a jacuzzi suite before we check in?', 'We set up after check-in, usually between 3 and 6 PM, while you are out. Arrange access with the front desk or meet us at the room, and we are gone before you come back.'],
      ['Are these hotels in Memphis itself?', 'Big Cypress Lodge is downtown, in the Pyramid. Courtyard Memphis East/Bill Morris Parkway is in East Memphis. Hampton Inn & Suites Millington is in Millington, north of Memphis and one of the towns we serve.'],
    ],
  },
  {
    ...base,
    kind: 'guide',
    key: 'hotel-staycation', file: 'guides/couples-staycation-ideas-memphis.html', url: '/guides/couples-staycation-ideas-memphis',
    title: 'Couples\' Staycation Ideas in Memphis | Porch &amp; Party',
    description: 'Couples\' staycation ideas in Memphis: pick a hotel, plan the evening, and come back to a room already decorated with petals, LED candles and balloons.',
    eyebrow: 'Memphis Guide', h1: 'Couples\' staycation ideas in Memphis', crumb: 'Couples\' Staycation Ideas',
    targets: ['couples staycation ideas memphis', 'romantic staycation memphis', 'memphis staycation for couples'],
    answer: 'A couples\' staycation in Memphis is a night or two away together without leaving town: a hotel room downtown or nearby, an evening out on the river or Beale Street, and a room that feels like an occasion when you come back. The easiest version is to book the room and have Porch &amp; Party decorate it while you are out.',
    serviceName: 'Couples\' staycation ideas in Memphis',
    images: [PHOTO.romantic, PHOTO.birthday, PHOTO.hallway],
    faqH2: 'What do people ask about a Memphis staycation for couples?',
    sections: () => [
      { id: 'pick-the-room', h2: 'Where should a couple stay for a Memphis staycation?',
        body: '<p>Pick the room for the feeling you want. Downtown puts Beale Street, the river and South Main in walking distance; East Memphis, Germantown and Cordova are quieter, with easy parking. A room with a tub or a view is worth asking for. Our guides to <a href="/hotels">romantic hotel rooms in Memphis</a> and <a href="/guides/memphis-hotels-with-jacuzzi-in-room">Memphis hotels with an in-room jacuzzi</a> are good places to start.</p>' },
      { id: 'ideas', h2: 'What are good staycation ideas for couples in Memphis?',
        body: '<ul><li><strong>Sunset on the river:</strong> walk the riverfront or Big River Crossing, then dinner downtown.</li><li><strong>Music night:</strong> live blues on Beale Street, then back to the room.</li><li><strong>South Main evening:</strong> dinner and the galleries, an easy walk from many downtown hotels.</li><li><strong>A slow morning:</strong> late checkout, breakfast in, no plans.</li><li><strong>The surprise room:</strong> you go out to dinner; you come back to petals, candles and balloons.</li></ul>' },
      { id: 'the-room', h2: 'How do I make the hotel room feel special?',
        body: `<p>Decor does the most for the least effort: a rose-petal walkway and heart on the bed, LED candles, balloons in your colors and a sign. ${ledLine()}</p>${packagesTable()}` },
      { id: 'timing', h2: 'How does the timing work?',
        body: `<ol><li>Book the room. ${blankHotel()}</li><li>Check in, then arrange access with the front desk or meet us at the room.</li><li>Go out. ${windowLine()}</li><li>Come back to a finished room. ${takedownLine()}</li></ol>` },
    ],
    faq: () => [
      ['How much does a decorated staycation room cost?', `${packagesLine()}, on top of the hotel room you book. These are starting prices; your quote depends on the room and how full you want it.`],
      ['Is one night enough for a staycation?', 'For most couples, yes: check in mid-afternoon, go out for the evening, come back to the room and ask for late checkout. Two nights gives you a full lazy day in between.'],
      ['Which towns do you decorate hotel rooms in?', `${cityList()}.`],
      ['Do we have to be out of the room while you decorate?', 'Yes, that is the point: you go out, we set up, usually between 3 and 6 PM, and we text you when it is ready.'],
      ['Can you set up a staycation for a birthday or anniversary?', 'Yes. Most of our hotel rooms are for an anniversary, a birthday, a proposal or "just because". Tell us the occasion and colors on the request form.'],
    ],
  },
];

/**
 * The jacuzzi list (page 6). Every hotel here shows an in-room whirlpool, jetted or air tub on the
 * hotel's OWN website, checked on the date given (owner rule 8 Nov 2026: drop any we cannot
 * confirm). Dropped on 8 Nov 2026 because their own sites did not show an in-room jetted tub or
 * would not load room details: The Peabody (jacuzzi is at the athletic club), Hotel Pontotoc
 * (showers / shower-over tub), River Inn of Harbor Town (garden tubs, jets not stated), The James
 * Lee House (soaking and clawfoot tubs), The Guest House at Graceland, SpringHill Suites Memphis
 * Downtown, Wingate Memphis East, Comfort Suites Cordova, Quality Inn Germantown and Olive Branch,
 * Best Western Plus Goodman Inn (bot check), Plantation Oaks Suites (no official site found).
 */
const JACUZZI = [
  { name: 'Big Cypress Lodge', area: 'downtown Memphis, inside the Pyramid', room: 'the Treehouse and Governor\'s Suite list bathrooms "complete with air tubs", and the Duck Cabin and Fly Fishing Lodge each list an air tub', source: 'https://big-cypress.com/accommodations/suites/', checked: '2026-11-08', checkedLabel: '8 Nov 2026', how: 'WebFetch of the suites page: "Two bathrooms, complete with air tubs" (Treehouse), "Three bathrooms (two air tubs)" (Governor\'s Suite)' },
  { name: 'Courtyard Memphis East/Bill Morris Parkway', area: 'East Memphis', room: 'a "King Guest Room - Whirlpool"', source: 'https://www.marriott.com/en-us/hotels/memlx-courtyard-memphis-east-bill-morris-parkway/photos/', checked: '2026-11-08', checkedLabel: '8 Nov 2026', how: 'the hotel\'s own photo gallery on marriott.com, image titled "King Guest Room - Whirlpool"' },
  { name: 'Hampton Inn & Suites Millington', area: 'Millington', room: 'a "1 King Bed Studio Suite Whirlpool"', source: 'https://www.hilton.com/en/hotels/memmlhx-hampton-suites-millington/rooms/', checked: '2026-11-08', checkedLabel: '8 Nov 2026', how: 'the hotel\'s own rooms page on hilton.com lists "1 King Bed Studio Suite Whirlpool Nonsmoking"' },
];

/** The three hand-written question pages (search-loop format), linked from the hub. */
const QUESTIONS = [
  { file: 'questions/how-many-rose-petals-for-a-hotel-room.html', url: '/questions/how-many-rose-petals-for-a-hotel-room', label: 'How many rose petals for a hotel room?' },
  { file: 'questions/can-you-use-rose-petals-and-candles-in-a-hotel.html', url: '/questions/can-you-use-rose-petals-and-candles-in-a-hotel', label: 'Can you use rose petals and candles in a hotel?' },
  { file: 'questions/how-to-set-up-a-hotel-room-for-a-romantic-night.html', url: '/questions/how-to-set-up-a-hotel-room-for-a-romantic-night', label: 'How to set up a hotel room for a romantic night' },
];

/** All ten blitz pages, for the hub's links and the validator. */
const ALL = () => [...PAGES.map((p) => ({ file: p.file, url: p.url, label: p.h1 })), ...QUESTIONS];

/** The done-for-you block (owner ruling 8 Nov 2026), twice on every hotel page. */
function doneForYou(where, lead) {
  const text = lead || 'Rather have it done for you? Porch &amp; Party brings everything and sets up the whole hotel room while you are out: petals, LED candles, balloons and a sign, ready when you walk in.';
  return `<aside class="dfy-block" data-done-for-you="${where}"><p>${text}</p><p class="dfy-links"><a href="${PRICE_TOOL}" data-dfy-price>Price my party or hotel room &rsaquo;</a> <a href="${REQUEST}" data-dfy-request>Check my date &rsaquo;</a></p></aside>`;
}

module.exports = { PAGES, QUESTIONS, JACUZZI, ALL, HUB, CITIES, cityList, doneForYou, packagesTable, packagesLine, ledLine, takedownLine, windowLine, hotelsLine, blankHotel, PRESETS, TAKEDOWN, REQUEST, PRICE_TOOL, PHOTO, HOTEL_WINDOW: PARTY.HOTEL_WINDOW };

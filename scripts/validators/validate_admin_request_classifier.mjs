#!/usr/bin/env node
/**
 * The one request classifier decides rentals from REAL games only (live bug, 18 Oct 2026:
 * the only real customer, a birthday decor job, had "n/a" in the old form's games question
 * and a default "One day", and his card read as a game rental: "Games: n/a for one day",
 * step 5 "Returned", primary button "Mark returned").
 *
 * Fails when:
 *  1. any "no games" answer (blank, n/a, N/A, na, none, no, -, not needed...) makes a request
 *     a rental, or "How long?" alone does;
 *  2. a decor request that also names a real game/bundle is not BOTH rental and decor;
 *  3. an anonymised copy of that customer's row renders with any rental wording (Games:,
 *     Returned, Mark returned) or without the decor next step (Mark job done, Job done);
 *  4. an n/a answer line is shown on the card, or a scheduled card shows a bare "Scheduled"
 *     chip next to the dated "Scheduled for ..." one.
 * Rule 0: fewer than 10 checks run is a failure.
 */
import { mod } from './lib/admin_harness.mjs';

const { rowsToRequests } = await mod('functions/_lib/sheet.mjs');
const { realGamesAnswer } = await mod('functions/_lib/pricing.mjs');
const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
const V = await mod('functions/_lib/views.mjs');
const fixture = (await mod('data/admin/fixture-request.json')).default;
const headers = fixture.values[0];
const errors = [];
let checks = 0;
const check = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// A row in the old form's shape: only the named columns filled.
function row(fields) {
  return headers.map((h) => (Object.prototype.hasOwnProperty.call(fields, h) ? fields[h] : ''));
}
const base = {
  Timestamp: '10/15/2026 12:00:00', 'Email Address': 'decor.customer@example.com', 'Full name': 'Decor Customer', 'Phone number': '901-555-0142',
  'What do you need?': 'Event decor', 'How long?': 'One day (24 hours)', 'Pickup date': '10/17/2026',
  'Event type': 'Birthday', Location: 'Memphis', 'Event date': '10/17/2026', 'Please confirm': 'I confirm',
};

for (const na of ['', 'n/a', 'N/A', 'na', ' NA ', 'none', 'None', 'no', 'No.', '-', '--', 'not needed', 'Not Needed', 'n / a']) {
  const [r] = rowsToRequests([headers, row({ ...base, 'Which games?': na })]);
  check(r && !r.wantsRentals && !r.gamesAnswer && !r.durationAnswer, `games answer ${JSON.stringify(na)} made a rental (wantsRentals=${r && r.wantsRentals}, gamesAnswer=${JSON.stringify(r && r.gamesAnswer)})`);
  check(r && r.wantsDecor, `games answer ${JSON.stringify(na)}: the decor request lost its decor`);
}
{
  const [r] = rowsToRequests([headers, row({ ...base, 'What do you need?': 'Game rentals', 'Which games?': 'n/a' })]);
  check(r && !r.wantsRentals, 'a "Game rentals" tick with no real game made a rental (never inferred without a real game)');
}
for (const games of ['Giant Uno', 'Cornhole set, Giant Uno', 'Pick 3 bundle ($110)', 'The Whole Party, all 8 items ($235 day / $350 weekend)']) {
  const [r] = rowsToRequests([headers, row({ ...base, 'What do you need?': 'Game rentals, Event decor', 'Which games?': games })]);
  check(r && r.wantsRentals && r.wantsDecor && r.gamesAnswer === games, `decor + ${JSON.stringify(games)} is not both rental and decor`);
}
check(realGamesAnswer('a giant trampoline', PRICE_TABLE) === '', 'an answer naming no item from games.json counted as games');

// The anonymised live case: birthday decor, 17 Oct, paid in full, on the calendar, job not marked done.
{
  const [r] = rowsToRequests([headers, row({ ...base, 'Which games?': 'n/a', 'Indoors or outdoors?': 'N/A', "What's the occasion?": 'n/a' })]);
  const inv = { id: 7, number: 'PNP-2026-0007', status: 'paid', total_cents: 30000, deposit_due_cents: 15000, pay_plan: 'half', balance: { total: 30000, paid: 30000, remaining: 0, owed: 0, refundable: 0, void: false } };
  const html = V.dashboardPage({ requests: [r], statuses: { [r.key]: { status: 'paid', invoice_id: 7 } }, invoices: { 7: inv }, schedule: { [r.key]: { date: '2026-10-17' } },
    returns: {}, checklists: {}, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', missingPayment: [] });
  const card = html.slice(html.indexOf('<article class="card"'), html.indexOf('</article>'));
  check(card.length > 200, 'the decor card did not render');
  check(!/Games:/.test(card), 'decor card shows a "Games:" line');
  check(!/Mark returned/.test(card), 'decor card shows Mark returned');
  check(!/>\s*\d?\s*Returned/.test(card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/^/, '>')) && !/data-step="job_done"[^>]*>Returned/.test(card), 'decor card progress says Returned');
  check(/Job done/.test(card), 'decor card progress lacks "Job done"');
  check(/Mark job done/.test(card), 'decor card primary button is not Mark job done');
  check(/Scheduled <span data-scheduled>Sat 17 Oct<\/span>/.test(card) && !/chip sched/.test(card), 'decor card progress line lacks the dated Scheduled step (or the duplicate pill is back)');
  check(!/data-step="scheduled"/.test(card), 'decor card shows a bare "Scheduled" chip beside the dated one');
  check(!/<dd>\s*n\/a\s*<\/dd>|<dd>\s*N\/A\s*<\/dd>/i.test(card), 'an n/a answer line is shown on the card');
}

if (checks < 10) errors.push(`only ${checks} checks ran`);
if (errors.length) { console.error(`admin-request-classifier: FAIL\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`admin-request-classifier: ${checks} checks; "no games" answers never make a rental, real games always do, the decor card reads as decor`);

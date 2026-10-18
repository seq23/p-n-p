# Admin console: porchandparty901.com/admin

Phone-first invoicing console for Valerie (bookings). Owner-approved 14 Oct 2026.

## What it does
- **Requests**: read live from the request form's Google Sheet (`Form Responses 1`), newest first,
  as the `gsc-bot@gsc-automation-493801` service account (Sheets API, JWT signed in the Worker,
  cached 60 s). Each card shows contact, DOB, the ID file, the rentals/decor answers and
  a status chip (New / Invoiced / Deposit paid / Paid / Done, table `request_status`).
- **Walk-through checklist**: `/admin/checklist` prints the four-page checklist (blank, or
  `?r=` pre-filled from a request). `/admin/checklist/online?r=` is the same checklist as a form,
  autosaved to `request_checklist`, with up to 10 photos (`checklist_photos`, ≤ 1.5 MB each after
  the phone shrinks them to 1600 px). Its quote worksheet and "Agreed price / deposit / due date"
  pre-fill the invoice. Source wording: `functions/_lib/assets/walkthrough-checklist.html.txt`.
- **Invoices**: prefilled from the request with live prices from `data/rentals/games.json` and
  `data/offers/services.json` (items and bundles priced at the cheapest mix of the six bundles,
  The Whole Party at its weekend price on a weekend, refundable damage deposit, takedown add-on;
  never a delivery line: rentals v3 has no delivery). A rental invoice (any line from the rentals
  price table, `isRentalInvoice` in `functions/_lib/pricing.mjs`) adds "Pay the rest at pickup.
  Text or call 901-355-1518 to set your pickup time at Mt. Moriah Station." to the email, PDF,
  text message and invoice page. Numbers are
  `PNP-YYYY-NNNN`; pay plan (`pay_plan`: half / full / custom, migration 0003) decides what is asked for now;
  half is the default, full asks for the whole total by the due date, custom is a typed deposit.
  "See it before sending" saves the draft and shows the email inline on the invoice page.
  `GET /admin/invoices/:id/invoice.pdf` renders the same invoice as a PDF (functions/_lib/pdf.mjs,
  pdf-lib) for customers reached by text; "Text the invoice (PDF)" shares it from the phone and
  the `texted` status action marks it sent without an email.
- **Send**: HTML email from hello@porchandparty901.com with a copy (Bcc) to hello@; payment block
  from Settings (Zelle, Cash App, QR as an inline CID image, which Gmail renders; Gmail strips
  data: URIs). A test send goes to hello@ only with a `TEST` subject and changes nothing.

## Calendar & Bookings, Put away, Void (migration 0004, owner-approved 18 Oct 2026)
Built for Valerie on a phone: plain words, 48 px+ buttons, a Back link and a numbered 1-2-3 at
the top of every screen, and a printable guide at `/admin/help`.
- **One map of every button** (`functions/_lib/helptext.mjs`): each `<a>`, `<button>`, toggle and
  upload button carries `data-help` + a `title` sentence from the map; primary actions show a
  visible helper line; `/admin/help` lists every entry by screen (with a warning line on money
  and delete actions) plus "What each status means". `npm run validate:admin-tooltips` renders
  every screen in many states and fails on a control without its map entry, a map entry missing
  from the help page or never rendered, a screen without its steps or Back link, or a "More"
  toggle on Requests (its three actions are a visible sub-nav, with Today's list and Find a customer).
- **Request steps** (`functions/_lib/progress.mjs`), derived from facts, never one stored chip:
  1 New, 2 Invoice sent, 3 Deposit paid, 4 Scheduled, 5 Job done ("Returned" for rentals, set by
  Mark returned), 6 Paid in full; Void off the line. Money (table `payments`) and the job
  (bookings, `request_status.job_done_at`) are separate: a card can read "Scheduled · Paid in full ✓";
  it is Finished only when the job is done AND paid in full, and then offers "Put it away?".
- **Payment box** on each card and invoice: "Mark deposit received" (records the deposit asked
  for) and "Mark paid in full" (records the rest), each with a confirmation and "How did they
  pay?"; "That was a mistake: mark as not paid" voids the payment rows (never deletes); "Void"
  with "Void invoice PNP-… for …? The customer is not told…". A void invoice keeps its number,
  cannot be sent or marked paid, gets a VOID stamp (page and PDF), and the bookings it created
  leave the calendar and the feed (bookings she made by hand stay, unlinked). "More options"
  on an invoice holds only non-money actions. Balances: charges minus payments; the refundable
  damage deposit is shown on its own line and never counted as owed (`functions/_lib/ledger.mjs`).
- **Put away**: "Done — put away" sets `request_status.archived_at` (nothing deleted, the sheet
  untouched); a 6-second "Put away. Undo" banner; the Put away tab has "Bring back".
- **Bookings** (table `bookings`, kinds per service in `functions/_lib/kinds.mjs`, one colour per
  service: porch orange, party purple, grazing green, rentals blue, always with words). An invoice
  created, sent or marked texted from a request upserts its bookings by (request_key, kind):
  rental pickup on the form's "Pickup date" and return (One day = next day; Weekend = the next
  Monday), porch / party / grazing on "Event date", takedown on "Takedown date". A booking she
  made or changed by hand (`edited_by_hand`) keeps her date on every re-send. "Put on the
  calendar" on a card (or drag a request from "Unscheduled requests" onto a day on a computer)
  opens the pre-filled scheduling screen and marks the request Scheduled; deleting its last
  booking puts the request back to its previous status. Drag a booking to move it (confirm), or
  "Move to another day". Month view (games-out badge, "$ due", "Not returned yet") or List view
  (remembered per device); Upcoming 14 days; double-booking warning when an item is out with
  more people than its stock (bundles expanded from `data/rentals/games.json`).
- **Day sheet** `/admin/day/<date>` (and `/admin/day/today`): bookings in time order with phone,
  items, where, still owed, notes, "Load these items", availability strip, "Still to collect today";
  "Print this list", "Text it to me" (sms: to Settings "My phone number for my day list"),
  "Email it to me" (mailer, to "My email for my day list").
- **Notes** (table `booking_notes`, keyed to the booking and its request, so they survive moves
  and re-scheduling): internal only, shown on the calendar, day sheet and ICS, never in a
  customer email, text, invoice, PDF or reminder.
- **Mark returned** (table `rental_returns`): one tick per item, "Everything came back in good
  shape", note + photo for anything damaged (photos reuse the checklist photo store under key
  `return|…`); sets Job done, or "Returned — check damage" with the damage-deposit reminder; no
  money moves and nothing is sent. "Undo returned" restores the previous status. Overdue returns
  (return day passed in Memphis, not checked in) show at the top of Requests and Calendar.
- **Find a customer**: `/admin/search` (live as she types), accent/case-insensitive on
  `bookings.name_norm`, phone digits and email, plus requests never scheduled; put-away and void
  labelled; newest 50.
- **Tomorrow's reminders** (Memphis date) on Requests and Calendar: "Text reminder" is an
  `sms:<digits>?&body=…` link (marks itself sent), "Mark reminded", or "Email reminder" when
  there is no phone. Wording per kind lives only in `functions/_lib/reminders.mjs` and is
  transactional, as the terms' Text messages clause allows. The private Worker `pnp-mailer`
  emails the same reminder at 10 AM Memphis to customers with an email (crons `0 15 * * *` and
  `0 16 * * *` UTC; only the run that is 10 AM in America/Chicago works, so daylight saving needs
  no change), Bcc hello@, claiming `email_reminded_at` before sending so it never double-sends;
  void and put-away requests are skipped. Deploy it with `npm run mailer:deploy` (it now holds
  the `pnp-admin` D1 binding).
- **Google Calendar**: `/api/calendar/<64-hex token>.ics` (token in settings `calendar_token`,
  made on first visit to "Link my Google Calendar", replaced by "Make a new private calendar link"
  in Settings). The ONE admin route outside the session guard, because Google fetches it with no
  cookie: a wrong token is 404, every answer is noindex, never in the sitemap or llms files
  (`validate:admin-noindex`). RFC 5545: all-day events unless a time is set, UID
  `booking-<id>@porchandparty901.com`, SUMMARY "Rentals: Rental pickup — Jane Doe", CRLF, folded.
  Google refreshes subscribed calendars on its own schedule (hours); the admin Calendar is live.

Proof: `npm run validate:admin-calendar` runs migration 0004 over sample rows (statuses mapped,
payments backfilled, nothing lost), then the whole flow through the real guard and router on a
local SQLite copy: archive round trip, bookings from an invoice with no duplicates, payments,
void, scheduling and unscheduling, move + ICS, notes kept out of customer outputs, reminders
(Memphis date boundary, sms: encoding, no double email), check-in, games out, search. It needs
Node >= 22.13 (`node:sqlite`); CI runs Node 22.

## Quote form contract (rentals v3, owner-approved 15 Oct 2026)
The Google Form is rebuilt by hand; the admin prefill maps these exact strings
(`formChoice` in `data/rentals/games.json`). `npm run validate:admin-prices` reads this list and
fails if a string is missing from the data, maps to the wrong price, or names a hidden item.

"Which games?" (checkboxes):
- `Giant Connect Four`
- `Cornhole set`
- `Giant Checkers`
- `Giant Color Stack`
- `Giant Uno`
- `Grab the Mic`
- `Inflatable movie screen`
- `Card table with cup holders`
- `Pick 3 bundle ($110)`
- `Pick 5 bundle ($175)`
- `Whole Yard, all 6 games ($195)`
- `Movie Night, screen + 2 games ($110)`
- `Game Night, card table + 2 games ($85)`
- `The Whole Party, all 8 items ($235 day / $350 weekend)`

"How long?" (multiple choice):
- `One day (24 hours)`
- `Weekend (Friday pickup, Monday return)`

"Pickup date" replaces "Delivery date". The delivery address, city and pickup-time questions are
gone: pickup and return are at Mt. Moriah Station, time set by text or call after payment.

## Where things live
| Piece | Place |
|---|---|
| Routes | `functions/admin/[[path]].js`, `functions/api/admin/[[path]].js`, code in `functions/_lib/` |
| Guard (auth, noindex, same-origin POST) | `functions/_lib/guard.mjs`, run by both `_middleware.js` |
| D1 | `pnp-admin`, binding `DB`, schema in `migrations/`. Pages deploys do NOT apply migrations: after a merge that adds one, run `npm run admin:migrate` (additive migrations only) |
| Reminders cron | `workers/pnp-mailer` `scheduled` handler, crons 15:00 + 16:00 UTC gated to 10 AM Memphis, D1 binding `DB` |
| Email | Cloudflare Email Service. Pages cannot hold `send_email`, so the private Worker `workers/pnp-mailer` holds it and Pages calls it through the `MAILER` service binding (`npm run mailer:deploy`) |
| Secrets (Pages, production) | `PNP_ADMIN_PASSWORD` (bootstrap password), `PNP_ADMIN_SESSION_KEY` (cookie signing), `GOOGLE_SA_JSON` (service-account key) |

## Rules the code enforces
- One shared password. Changing it in Settings stores a salted SHA-256 in D1 that overrides the
  secret and signs every device out. Sessions: signed HttpOnly, Secure, SameSite=Lax cookie, 30 days.
  Sign-in: 10 attempts per hour per IP.
- `/admin` and `/api/admin/*` answer `X-Robots-Tag: noindex` and never appear in the sitemap or
  llms files (`npm run validate:admin-noindex`).
- Invoice prices and the checklist's printed prices cannot drift from the data files
  (`npm run validate:admin-prices`); the checklist prints exactly four pages and every online field
  has its printed label (`npm run validate:admin-checklist`).

## Local test
`npm run admin:dev` serves the console on localhost:8788 against a local D1 and the fake request
in `data/admin/fixture-request.json` (password `local-test-pass`). Email sending needs the
deployed site.

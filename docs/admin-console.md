# Admin console: porchandparty901.com/admin

Phone-first invoicing console for Valerie (bookings). Owner-approved 14 Oct 2026.

## What it does
- **Requests**: read from D1 (`requests`, migration 0006; `functions/_lib/requests.mjs`), newest
  first. The site form at porchandparty901.com/request writes there; the one real Google Form
  request was imported once (`npm run admin:import-form-request -- --invoice PNP-2026-0002`,
  source `google_form`, raw row kept, request_key unchanged so its status, invoice, payments,
  booking, notes and checklist stay linked, ID still the Drive link). The other Form Responses
  rows were tests: they stay in the sheet only. The Google Sheet is the archive and sync target
  (new tab `Site requests`); `Form Responses 1` is never written. Each card shows contact, DOB,
  the ID (site: a private photo, signed-in view; old form: the Drive link), "Agreed to rules on
  ...", "Referred by ...", every answer and the progress line. "Delete this ID" (asked first,
  permanent, logged) is the only way an ID is ever deleted; "IDs ready to delete" lists requests
  paid in full (rentals: returned). The top shows "This week: N new requests (by service)" for
  Mon-Sun America/Chicago with last week beside it; Money shows "Requests this month".
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

## Porch packages (owner-approved 18 Oct 2026)
- **One source**: `data/offers/porch_packages.json` (Stoop / Classic / Grand / Showstopper per
  season, fall and Christmas; inclusions; custom-design line; add-ons named, never priced; the
  10% fall + Christmas bundle). `scripts/lib/porch_packages.js` renders every surface from it.
- **Website**: the full grid + Offer / PriceSpecification schema on every page in the data file's
  `pages` (porch service pages, /pricing, porch articles), stamped by `npm run porch:install`
  (`scripts/install_porch_packages.js`, part of build:all); the FAQ "Price my porch" calculator
  (`/faq/#porch-picker`: season toggle, size hint, "Request this package").
- **/request porch path**: season, "How much decor are you picturing?" (the five owner answers),
  only the from-price and range per season (never a tier price), the final-quote line, "See
  examples and prices" (new tab), "Book both seasons", unpriced add-ons, notes.
  `/request?service=porch&season=fall&decor=classic` preselects both answers.
- **Admin**: the card reads e.g. "Porch: Fall · picturing a full porch (Classic, from $N)"; the
  invoice starts at that tier's minimum, and with both seasons adds the other season's package
  and an editable "-10% fall + Christmas bundle" line; `/admin/packages` shows the same grid,
  linked from Requests and the invoice screen. No migration: answers live in `requests.answers`.
- **Guard**: `npm run validate:porch-packages` (in validate:admin).

## Request cards + admin homepage (JOB B, owner-approved 18 Oct 2026, migration 0008)
- **Main nav**: Requests · Calendar & Bookings · Money · Settings · Help. Put away and Invoices
  left the nav: Put away is the collapsed "Put away (N)" section at the bottom of Requests ("Show
  put-away requests", `#put-away`, the only whitelisted disclosure in `validate:admin-tooltips`);
  `/admin/archive` redirects to `/admin/?pa=1#put-away` with it open. All invoices are linked from
  Money's steps panel.
- **Steps panel** (`stepsPanel` in `functions/_lib/helptext.mjs`) replaces the sub-nav button row
  and the separate steps box: Requests 1 "See who's asking." (Check for new requests · Find a
  customer; Open responses sheet · Open ID folder), 2 "Send a quote or invoice." (Start a blank
  invoice · Print a blank checklist; Porch packages), 3 "Plan your day and get paid." (Today's list
  · Calendar & Bookings). Same pattern on Calendar & Bookings and Money; 3 columns on a computer,
  stacked on a phone.
- **Cards** (`requestCard` in `views.mjs`): large service badge(s) with words in the four service
  colours (`kinds.mjs`) and a coloured left border; name large; ONE key-facts line (event or pickup
  day, where, Call); the compact 1-6 line; ONE big primary button (the next step); a secondary row;
  the Payment box; everything to read (answers, ID, checklist state, notes, history) behind "Show
  details". The buttons come from ONE rules table, `cardButtons` in `functions/_lib/cards.mjs`
  (service x stage): rentals never show porch, takedown or walk-through buttons; porch and party
  show the walk-through checklist and, once the install/setup is booked, Schedule takedown; grazing
  shows guest count + a rough food estimate (`foodPerHead` in `data/offers/services.json`) and an
  optional pickup; void shows only Bring back + Put away, finished only Put away, put away only
  Bring back. Scheduling buttons pass the booking kind (`/admin/calendar/new?r=…&kind=…`).
- **Filter chips**: All · Porch · Party & decor · Grazing · Rentals · Not paid yet (`?f=`), applied
  to the Put away section too. Weekly counts stay on top.
- **Not paid yet** (`functions/_lib/notpaid.mjs`, top of Money): every SENT, non-void invoice with
  charges still owed, most overdue first (red "N days late", amber within 3 days), with service
  badge, what for, invoice #, total, paid, STILL OWED, Call · Text a reminder (sms: with the amount,
  due date and invoice number; there is no public invoice page, so it names the invoice they were
  sent) · Email a reminder (`POST /admin/money/remind`, one tap, logs `invoices.reminded_at`) · Open
  invoice · Mark paid, and a total line. Drafts are listed apart as "Invoice not sent yet"; the
  refundable damage deposit is never owed. The Requests chip uses the same rule (`notPaidYet`).

- **Contextual scheduling** (migration 0009 adds `requests.takedown_note`): Porch → Schedule
  install, then takedown; Party & decor → Schedule setup, then takedown; Grazing → Schedule setup,
  then pickup (optional); Rentals → Schedule pickup + return as a pair (the return day defaults from
  the length, editable; the return is always required, its time may be left empty = not sure yet).
  The takedown is never required: once the install/setup is booked, the card asks "Takedown
  afterwards?" with Schedule it · Not sure yet (amber "Takedown: not decided yet" + note, listed in
  "Still to decide" on Calendar & Bookings, and Mark job done asks once) · Customer will handle it
  (no booking, no nagging), each with a note, stored as `requests.takedown_plan` +
  `takedown_note` (`POST /admin/requests/takedown`). Booking a takedown sets the plan to
  `scheduled`. The form's takedown answer maps straight in (yes → scheduled, no →
  customer_handles, not sure → not_sure). Job done never needs a takedown.
- **The takedown gates Finished** (owner, 18 Oct 2026; migration 0010 adds
  `requests.takedown_date` and `bookings.done_at`; `functions/_lib/takedown.mjs`, the one place
  every screen asks). A porch/party request whose customer asked for a takedown (takedown_plan
  scheduled / not_sure, the takedown add-on on the invoice, or a takedown booking) is not Finished,
  gets no "Put it away?", until the takedown booking is marked done ("Mark takedown done" on the
  card and the Day sheet, from the takedown day; `POST /admin/calendar/bookings/:id/takedown-done`,
  `undo=1` takes it back) or takedown_plan = customer_handles. After Job done the one big button is
  Schedule takedown (not booked) or Mark takedown done (its day reached); the progress line reads
  "Job done ✓ · Takedown: Sun 18 Oct" / "Takedown done ✓". The old Google Form's "Need us to take it
  down afterwards?" + "Takedown date" map at source (the import) into takedown_plan +
  takedown_date; the date only PREFILLS Schedule takedown, nothing is booked until she saves it.
  Asked-for, not booked: amber "Takedown requested for Sun 18 Oct — tap to schedule" on the card,
  "Takedowns to schedule" at the top of Calendar & Bookings, on that day's Day sheet and in the
  Monday summary's Needs you. Existing rows: `npm run admin:backfill-takedown` (idempotent; a row
  with any "Takedown…" event is never touched again; `--invoice PNP-… --owner-date YYYY-MM-DD`
  records the owner's day). The thank-you email still follows Job done. "IDs ready to delete" is
  the last box on Requests, after Put away. Proof: `npm run validate:admin-takedown`.
- **Day sheet**: when a customer with a balance is booked that day, a line gives the Not paid yet
  count and total, linking to Money.
- **Monday summary email** (`functions/_lib/weekly.mjs`): automatic every Monday 7:00 AM
  America/Chicago from the pnp-mailer hourly cron `0 * * * *` (the run whose Memphis weekday is
  Monday and hour is 7: 12:00 UTC in daylight time, 13:00 UTC in standard time, so daylight saving
  needs no change), to the Settings day-list email. Last week (new requests by service, jobs done,
  money received, expenses), This week (bookings by date, games out per day, still to collect),
  Needs you (holds ending soon, overdue returns, damage to decide, takedowns not decided, requests
  with no reply after 2 days, IDs ready to delete, receipts needing checking, not paid yet). First
  name + last initial only; every line links into /admin. Idempotent per week (claims
  `settings.weekly_summary_week` before sending; released if the send fails). Settings: on/off
  (`weekly_summary`, default on) and "Send me this week's summary now". Redeploy the Worker with
  `npm run mailer:deploy` after a change; `npx wrangler@4.151.0 deployments list` (in
  workers/pnp-mailer) or the dashboard's Triggers tab shows the cron.

Proof: `npm run validate:admin-weekly` (CDT/CST hours, windows, once per week, off switch, send
now, no PII, sections and links) and `npm run validate:admin-cards` (rules table over every service x stage, colours, key facts,
filters, Put away section, Not paid yet math and the Money list end to end, reminders, contextual
scheduling links).

## Calendar & Bookings, Put away, Void (migration 0004, owner-approved 18 Oct 2026)
Built for Valerie on a phone: plain words, 48 px+ buttons, a Back link and a numbered 1-2-3 at
the top of every screen, and a printable guide at `/admin/help`.
- **One map of every button** (`functions/_lib/helptext.mjs`): each `<a>`, `<button>`, toggle and
  upload button carries `data-help` + a `title` sentence from the map; primary actions show a
  visible helper line; `/admin/help` lists every entry by screen (with a warning line on money
  and delete actions) plus "What each status means". `npm run validate:admin-tooltips` renders
  every screen in many states and fails on a control without its map entry, a map entry missing
  from the help page or never rendered, a screen without its steps or Back link, or a "More"
  toggle on Requests (its actions are in the steps panel).
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
  untouched); a 6-second "Put away. Undo" banner; the Put away section at the bottom of Requests
  has "Bring back" on each.
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
  emails the same reminder at 10 AM Memphis to customers with an email (cron `0 * * * *` UTC,
  hourly; the daily work runs only in the run that is 10 AM in America/Chicago, which is 15:00 UTC
  in daylight time and 16:00 UTC in standard time, so daylight saving needs no change; every hour
  it also expires unpaid rental holds and sends the hold reminders), Bcc hello@, claiming `email_reminded_at` before sending so it never double-sends;
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

## Money, taxes, expenses and the Google Sheet (migration 0005, owner-approved 18 Oct 2026)
- **Money tab** `/admin/money?month=YYYY-MM`: "Money received" (payments whose `received_on`,
  a Memphis date, falls in the month), "Still owed for this month's jobs", "Jobs this month",
  income by service (Rentals / Porch decorating / Party & decor / Grazing tables / Other, from
  each invoice's lines through `kinds.mjs`), damage deposits held / refunded / kept, Expenses and
  "Left after expenses" (a simple difference, not profit or tax). Every total opens the rows
  behind it. A 12-month list with a year switcher. Pure sums in `functions/_lib/money.mjs`: a
  payment covers charges first, the rest is a damage deposit held (never income); refunds and
  deposits kept for damage are their own `payments.kind` rows; void invoices are never counted.
- **Damage deposit** box on an invoice: "Refund the damage deposit" / "Keep some for damage"
  (confirmations, amount, method). Records only; no money moves.
- **Year-end summary for taxes** `/admin/money/year?year=`: Porch & Party / Kerseta LLC, money
  received by month, service and payment method, refunds, deposits kept (income), deposits held
  at year end (liability), jobs, expenses by category and month with the itemised list, every
  invoice (number, date, customer, total, paid) and voided invoices apart. "Download PDF",
  "Download spreadsheet (CSV)" (UTF-8 with BOM), "Email it to me" (PDF + CSV attached, to the
  day-list email), "Write the Year tab in the Google Sheet", "Download all receipts (zip)". Footer
  on all: "Prepared from Porch & Party's admin records for your tax preparer. This is a summary,
  not tax advice." No tax is computed.
- **Expenses**: "Add a receipt" (camera or files, several at once; photos shrink to 1600 px on the
  phone; PDFs too) stores the original in the private R2 bucket `pnp-receipts` (binding
  `RECEIPTS`, no public URL, served only by the signed-in `/admin/money/expenses/<id>/receipt`).
  Workers AI (binding `AI`, `@cf/meta/llama-3.2-11b-vision-instruct`; PDFs go through
  `AI.toMarkdown` first) reads vendor/date/total/tax/category as strict JSON, parsed defensively;
  every receipt lands as "Needs checking" with low-confidence fields in amber ("Please check
  this"); nothing counts until she taps Save. $0 posture: 25 reads a Memphis day (`ai_usage`),
  well inside the free daily allocation; on failure or the cap the form opens empty with a plain
  message. "Type it in instead" always works. Categories are editable in Settings.
- **Google Sheet sync** (`functions/_lib/sheets-sync.mjs`): tabs "Bookings" (one row per booking,
  upserted by Booking ID), "Monthly totals" (rewritten), "Expenses" (upserted by Expense ID) and
  "Year YYYY" (on demand) in the request sheet, as gsc-bot with the spreadsheets scope. Every
  range passes `rangeFor()`, which refuses any other tab ("Form Responses 1" is never touched).
  After every admin change the sync runs in the background (`waitUntil`); a failure goes to
  `sync_queue`, pages say "Google Sheet will catch up shortly" and retry, Settings has "Update the
  Google Sheet now", and the pnp-mailer cron asks for a full resync daily through
  `POST /api/sync/<settings.sync_token>` (outside the guard like the ICS feed: wrong token 404,
  noindex, POST only; `validate:admin-noindex`). The sheet must be shared with
  `gsc-bot@gsc-automation-493801.iam.gserviceaccount.com` as Editor.

Proof: `npm run validate:admin-money` (Memphis month/year boundaries, deposits apart from income,
void excluded, categories reconcile with the year, CSV/PDF, receipts never auto-saved, AI fallback
and cap, receipts private, zip holds only the year's receipts, sheet sync upsert/idempotent/never
another tab/retry queue, the cron hook).

## Site request form (owner-approved 18 Oct 2026)
- **Page**: `request.html` (built by `scripts/generators/build_request_pages.js`, public and
  indexable) rendered and answered by the Pages Function `functions/request/index.js`
  (`functions/_lib/request-submit.mjs`); markup and validation in `functions/_lib/request-form.mjs`.
  Page 1 asks what they are planning in the canonical service order with prices; each service has
  its own questions; every path needs the government photo ID (owner note above the upload) and
  the rules checkbox (`/rules`, `rules.html`, version `RULES_VERSION`; agreed time, version, name
  and IP are stored and logged). Works without JavaScript (server validation, errors listed at the
  top with links); with JavaScript the other sections hide and the phone shrinks the ID photo.
- **ID photos**: private R2 bucket `pnp-ids` (binding `IDS`), JPEG/PNG only, 10 MB max, EXIF and
  other metadata stripped (`functions/_lib/image-clean.mjs`), random object names. Read only by
  the signed-in `/admin/requests/id` route; nothing deletes one except "Delete this ID".
- **Spam ($0)**: honeypot, a server-signed render time (under 3 s is refused), Cloudflare Turnstile
  when `TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` are set, 5 requests per IP per hour (3 without the
  robot check). A request sent with JavaScript off is taken and marked on its card.
- **Rentals are a booking**: live availability (`/api/request/availability`, counts only) greys
  booked games; the exact total, due-now (damage deposit + 50%) and at-pickup amounts are shown;
  submitting holds the games 24 hours (`holds`, Settings `hold_hours`, `hold_auto_expire`), puts
  pickup and return on the calendar and drafts the invoice for Valerie to send. An unpaid hold
  expires by itself at its end time (games free again, request stays New, "Hold expired" logged);
  "Mark deposit received" confirms it.
- **After sending**: `/request/received?k=` (noindex) shows the next steps; a confirmation email
  goes from hello@ (`functions/_lib/messages.mjs`, the one templates map and `sendMessage` seam).
- **Referrals**: each request gets a random 8-letter code; `/r/<code>` sets a cookie the form reads
  and the card says "Referred by <name>". No reward, no discount, no review ask.
- **Holds (Valerie's controls)**: on a held rental card, in "Holds ending soon" (top of Requests and
  Calendar & Bookings, threshold in Settings, tab badge "N holds ending soon") and in the
  Calendar's Held view: Give them more time (+24 h, +48 h, a picked Memphis day and time), Keep
  holding — I'll handle it (no end time), Release now, Mark deposit received, Call, Text a
  reminder / Email them. Settings: hold length, automatic expiry switch, reminder on/off and
  hours before the end. Every change is logged on the request. Holds ending a day are on its Day
  sheet and in "Text it to me".
- **Messages**: one templates map (`functions/_lib/messages.mjs`) and one seam, `sendMessage(channel,
  template, ctx)`: texts are free sms: links from Valerie's phone (no paid SMS provider), every text
  button has an "Email them" twin that sends at once from hello@. Confirmation: emailed by itself
  once when a deposit is marked received, then the "Text them it's confirmed" screen. Thank-you:
  emailed by itself the morning after Job done / Returned (10 AM Memphis cron), once; never for
  void, no email, or "Don't send a thank-you"; undoing Job done first cancels it; the rental
  deposit line only after a clean return. It carries the referral block (four services, Text /
  Email a friend, Share on Facebook, the customer's /r/<code>). No review ask, no discount.
- **Mailer cron** (`workers/pnp-mailer`, `npm run mailer:deploy`): hourly `0 * * * *` UTC: hold
  expiry and hold reminders; at 10 AM Memphis: day-before reminders, thank-yous, sheet resync;
  Monday 7 AM Memphis: Valerie's weekly summary.
- **Guard**: `npm run validate:request-form` and `npm run validate:request-messages` (in `validate:admin`).

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
| Receipts | R2 bucket `pnp-receipts` (binding `RECEIPTS`, private), Workers AI binding `AI` (wrangler.toml) |
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

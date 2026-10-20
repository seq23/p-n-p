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
  price table, `isRentalInvoice` in `functions/_lib/pricing.mjs`) adds the rental note to the
  email, PDF, text message and invoice page, worded from the invoice's own numbers
  (`functions/_lib/invoice-note.mjs`, see "Rental extras" below). Numbers are
  `PNP-YYYY-NNNN`; pay plan (`pay_plan`: half / full / custom, migration 0003) decides what is asked for now;
  half is the default, full asks for the whole total by the due date, custom is a typed deposit.
  "See it before sending" saves the draft and shows the email inline on the invoice page.
  `GET /admin/invoices/:id/invoice.pdf` renders the same invoice as a PDF (functions/_lib/pdf.mjs,
  pdf-lib) for customers reached by text; "Text the invoice (PDF)" shares it from the phone and
  the `texted` status action marks it sent without an email.
- **Send**: HTML email from hello@porchandparty901.com with a copy (Bcc) to hello@; payment block
  from Settings (Zelle, Cash App, QR as an inline CID image, which Gmail renders; Gmail strips
  data: URIs). A test send goes to hello@ only with a `TEST` subject and changes nothing.
- **Valerie's copies** (owner, 19 Oct 2026): only invoices and receipts are copied (Bcc) to hello@.
  Thank-yous, request confirmations, reminders, hold reminders and every other customer email go
  without a copy; each is still logged on the card. One rule decides it: `ownerCopy(kind)` in
  `functions/_lib/util.mjs` (`npm run validate:owner-email`).
- **New-request email**: each website request emails Valerie once, at Settings "My email for my day
  list" (`day_list_email`), subject `New request: <First L.> · <services> · <date>`, every form
  answer labelled, "ID photo uploaded" (never attached) and an "Open this request" button to the
  card. Never for phone-call requests. Claimed by `requests.owner_emailed_at` (migration 0014);
  the card logs "New-request email sent to Valerie" or the failure. `functions/_lib/owner-new-request.mjs`.

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
- **Main nav**: Requests · Calendar & Bookings · Money · Inventory · Settings · Help (Inventory added 19 Oct 2026). Put away and Invoices
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
  day, where, Call); the compact 1-6 line (it carries "Scheduled Sat 17 Oct" and Paid in full, so no
  status pills repeat it beside the name; a paid card has no Payment box, its undo is one small link
  on the progress line and on the Edit page); the inline Takedown line; ONE big primary button (the
  next step; a "Next: …" wait shows in that same slot); a compact row of small secondary buttons;
  the Payment box; the thank-you as ONE small line at the bottom; everything to read (answers, ID, checklist state, notes, history) behind "Show
  details". The buttons come from ONE rules table, `cardButtons` in `functions/_lib/cards.mjs`
  (service x stage): rentals never show porch, takedown or walk-through buttons; porch and party
  show the walk-through checklist and the inline Takedown line; grazing shows guest count + a rough
  food estimate (`foodPerHead` in `data/offers/services.json`) and the same line for its optional
  pickup; void shows only Bring back + Put away, finished only Put away, put away only
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
  The takedown is never required. **Inline takedown row** (owner, 18 Oct 2026, "too many steps";
  `takedownRow` in `views.mjs`, `cards.mjs inlineRowKind`, `POST /admin/requests/takedown-inline`):
  every porch and party & decor card has ONE line "Takedown:" with a date box (the booked day, else
  the form's / owner's takedown date, else the day after the install/setup), an optional time and
  Save · Not sure yet · Customer will handle it. Save books / moves the `<kind>_takedown` booking in
  place (edited_by_hand = 1, takedown_plan = scheduled, one history line) and comes back to the same
  card with "Takedown on the calendar for Tue 20 Oct ✓". Booked: "Booked for Tue 20 Oct" + a one-tap
  **Mark takedown done** (any day; it is the card's one big button after Job done) + Change / Remove
  (Remove also clears the asked-for day, so nothing re-books it). Grazing has the same line for its
  optional pickup (Save / Change / Remove). Rentals never. Only a FIRST booking (install, setup,
  pickup) marks a request Scheduled (`calendar.mjs SECOND_KINDS`, `markScheduled` never moves
  job_done / paid / void back). The older choices: Not sure yet (amber "Takedown: not decided yet" + note, listed in
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
  card's Takedown line and the Day sheet, one tap, any day; `POST /admin/calendar/bookings/:id/takedown-done`,
  `undo=1` takes it back) or takedown_plan = customer_handles. After Job done the next step is the
  Takedown line's Save (not booked) or its Mark takedown done (booked); the progress line reads
  "Job done ✓ · Takedown: Sun 18 Oct" / "Takedown done ✓". The old Google Form's "Need us to take it
  down afterwards?" + "Takedown date" map at source (the import) into takedown_plan +
  takedown_date. **A takedown date on the form is booked by itself** (`takedown.mjs
  autoTakedownRow` / `autoBookTakedown`: porch/party, plan scheduled, a real date, live, and no
  takedown booking of either kind yet; ON CONFLICT DO NOTHING), on arrival (`/request`, the import,
  the local fixture) and again when the install/setup is booked; never over a booking she made or
  edited; Not sure yet / Customer will handle it / no date book nothing. Asked-for, not booked (a
  yes with no day): the amber "Asked for, not booked yet" Takedown line on the card,
  "Takedowns to schedule" at the top of Calendar & Bookings, on that day's Day sheet and in the
  Monday summary's Needs you. Existing rows: `npm run admin:backfill-takedown` (idempotent; maps
  the answers, then books every dated takedown nobody booked yet (`autoBookPlan`); a row
  with any "Takedown…" event is never re-mapped; `--invoice PNP-… --owner-date YYYY-MM-DD`
  records the owner's day). The thank-you email still follows Job done. "IDs ready to delete" is
  the last box on Requests, after Put away. Proof: `npm run validate:admin-takedown` and
  `npm run validate:admin-takedown-inline`.
- **Requested chips** (`functions/_lib/requested.mjs`): every live request (not void, put away or
  test) whose asked-for day (event date; rentals the pickup date) has no booking of that kind shows
  on the month, the day page and Today's list as an OUTLINED chip (border only) in its service
  colour: "Requested · Porch: Ada E."; tap opens the card. Legend: "Filled = booked · Outlined =
  asked for, not booked yet". Requested rentals never count as games out ("N games asked for"
  apart); a held rental is filled and says "Held", an expired hold reverts to Requested. They are
  not bookings: never in the ICS feed or the Sheet's Bookings tab.
- **Projector** (`data/rentals/games.json adminItems`, `admin_only: true`; `prices.mjs TRACK_TABLE`):
  tracked In/Out on the Day sheet, counted for availability and the double-booking warning,
  pickable on the booking form; never priced and never on a public page (the public generators read
  `games` and `extras` only).
- **Day sheet**: when a customer with a balance is booked that day, a line gives the Not paid yet
  count and total, linking to Money. One block per job (owner, 18 Oct 2026: "too busy"): checkbox +
  "Anytime · Game pickup · Ada", items, place, "Still owed $X" only when > 0, notes in italics;
  timed jobs first, Anytime last; no "$0.00" total; "Load these items" only with 2+ pickups; the
  games grid "3 of 8 games out" with OUT tiles light red with a light diagonal X ("Out · back Tue
  20 Oct · Ada") and IN tiles light green ("In"), words always there for a black-and-white print.
  Print hides the banner, nav and buttons; Letter, one page for a normal day.
- **Daily to-do email** (`functions/_lib/todo-email.mjs`, owner-approved mock 19 Oct 2026): every
  day at 7:00 AM America/Chicago from the pnp-mailer hourly cron `0 * * * *`. UTC mapping: the run
  whose Memphis hour is 7 sends, which is 12:00 UTC in daylight time (CDT, UTC-5, mid-March to
  early November) and 13:00 UTC in standard time (CST, UTC-6); `chicagoHour` decides, so daylight
  saving needs no change. To the Settings day-list email. Subject "Your to-do list for <Tue 20 Oct>
  · Porch & Party". Numbered sections, each shown only when it has something: 1 Today's jobs (time
  or "time not set", First L., job, place, what to bring, what to collect or the deposit to give
  back), 2 Call these people back (`callback-list.mjs`: Called back not ticked, never phone or put
  away, oldest first, "Waiting N days", highlighted from 2 days), 3 Set a time (every booking from
  today on with no time, soonest first, highlighted within 2 days, Text prefilled from the `setTime`
  message template), 4 Book it or decide (called back with nothing on the calendar; takedowns and
  grazing pickups with no day), 5 Money (balances due today or late, never the damage deposit;
  holds ending today with Hold longer; games not returned). Then "Tomorrow, <day>" and the footer.
  Nothing in 1-5 and nothing tomorrow: only "All clear today". First name + last initial only; a
  phone only inside Call (tel:) / Text (sms:) links; every other link into /admin; HTML (one 600px
  column) plus plain text. Once per Memphis day (claims `settings.todo_email_day`; released if the
  send fails). Settings -> Emails: "Daily to-do email" on/off (`todo_email`, default on) and "Send
  me today's list now".
- **Monday = one email**: on Mondays the to-do email ends with "Your week (Monday summary)": new
  requests last week, jobs done, money in, tips, expenses, jobs in the next 14 days, from
  `weeklyData` (`functions/_lib/weekly.mjs`). There is no separate weekly email any more; the
  Settings switch `weekly_summary` (default on) now means "include Your week on Mondays". Redeploy
  the Worker with `npm run mailer:deploy` after a change; `npx wrangler@4.151.0 deployments list`
  (in workers/pnp-mailer) or the dashboard's Triggers tab shows the cron.

Proof: `npm run validate:admin-todo-email` (7 AM in CDT/CST, each section's rules, order and
highlights, deposits never owed, all clear, Monday merge, once a day, failure release, off switch,
send now, no PII), `npm run validate:admin-weekly` (one Monday email with Your week, windows, the
switch, figures) and `npm run validate:admin-cards` (rules table over every service x stage, colours, key facts,
filters, Put away section, Not paid yet math and the Money list end to end, reminders, contextual
scheduling links).

## Change anything on this request (owner-approved 18 Oct 2026, migration 0011)
- **Edit link** on every request card at every stage (New to Finished, Void and Put away
  included), in the card's "More" row with Add a note and Put away (step cards, 19 Oct 2026; `card.edit`). It opens ONE page,
  `/admin/requests/edit?r=…` (`functions/_lib/admin-edit.mjs`), sections in order, one Save each:
  1 **Bookings** (each booking's day, time, done tick, notes; Remove booking asks first),
  2 **Done dates** (Job done, Returned, Takedown done; empty = take it back through the same undo
  paths, so Finished recomputes; never after today), 3 **Invoice** (lines and amounts even after
  sent or paid; a paid invoice says "Changing this changes what they owe"; nothing is re-sent),
  4 **Payments** (amount, day, how paid; Add a payment; Remove this payment asks first and only
  sets `payments.voided_at`, the row stays and shows as removed), 5 **Status** (any of the six
  steps or Void, plus takedown plan / date / note; the steps follow the facts, so a chosen step
  writes them: an earlier step clears Job done and soft-removes payments, Paid in full records
  the rest, a booking keeps it at Scheduled and the page says so), 6 **Customer details** (name,
  phone, email, address, their notes; stored in `requests.details_edits` and laid over the form
  by `fromRow`, so the old Google Form raw row is never rewritten; bookings and live invoices
  follow, nothing is sent).
- **History**: every change is a `logEvent` line "old → new (by Valerie)", who = Valerie.
- **Everything follows**: the sheet sync runs after every admin POST (Bookings / Site requests
  tabs); the ICS feed reads the bookings live; a booking that changes day gets its day-before
  reminder again (`REMIND_AGAIN` in `calendar.mjs`, also for Move and Change this booking; the
  same day keeps "reminded", so nothing sends twice); the thank-you follows `job_done_at`
  (cleared before it went out = it never goes; `thankyou_emailed_at` is never cleared, so it is
  never sent twice); `syncMoneyStatus` (`ledger.mjs`) puts the invoice back to owing when a
  payment is removed or the total goes up.
- Proof: `npm run validate:admin-edit` (in validate:admin).

## Phone requests (owner-approved 18 Oct 2026, migration 0012)
Valerie added a phone-call booking with "Add a booking" and it never reached Requests: a
hand-added booking had `request_key` NULL and no request. Now (`functions/_lib/phone-requests.mjs`):
- **Add a booking** (no request) asks **Which service?**: Porch · Party & decor · Grazing · Game
  rentals (the four service colours, words shown), plus name, phone and email (optional). Saving
  makes a request with `source = 'phone'` (migration 0012 rebuilt the `requests` CHECK to allow
  it, every row and index kept) and books it with `saveRequestBooking`, so it is Scheduled and a
  rental keeps its pickup + return pair. It lands on Requests as a normal card with a **From a
  phone call** chip: steps, invoice, Edit, Not paid yet. History: "Added from a phone call by Valerie".
- **Just a calendar note (no customer)** keeps the old request-less booking, marked
  `bookings.calendar_note = 1` so the backfill never turns it into a request.
- A phone request has **no ID/rules prompts**: "ID: not collected (phone booking)" with an
  optional **Add ID photo** upload (`POST /admin/requests/id/upload`, same private bucket and EXIF
  stripping as the site form, logged); Rules "Not asked (phone booking)". **No hold** (holds are
  made only by the site form) and **no automatic confirmation email** (`autoConfirm` and the
  Email-it twin refuse source 'phone'); a phone card never shows "Confirmation email sent". The
  thank-you and the day-before reminders work as for any request with an email on file.
- **Rental length from the booked days**: a rental card (and a new invoice's lines) with both a
  pickup and a return day says "pickup Sun 18 Oct, back Tue 20 Oct (2 days)", never "for one day".
- **Month on a phone**: under 700 px the month is a day-by-day list with full chips (bookings and
  outlined Requested chips); the 7-column grid stays from 700 px up.
- **Backfill**: `npm run admin:backfill-phone [-- --dry-run]` makes a phone request for every
  request-less booking with a customer name (a rental pickup + return, or an install + its
  takedown, become one request), and converts a request already added by hand as source 'site'
  with "How it came in: Phone call" to 'phone', clearing the `confirm_emailed_at` that was set
  only to stop the automatic email (history line; no email is sent). Idempotent; counts only.
- Proof: `npm run validate:admin-phone` (in validate:admin).

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
  rental pickup on the form's "Pickup date" and return on its "Return date" (older requests:
  One day = next day; Weekend = the next Monday), porch / party / grazing on "Event date", takedown on "Takedown date". A booking she
  made or changed by hand (`edited_by_hand`) keeps her date on every re-send. "Put on the
  calendar" on a card (or drag a request from "Unconfirmed requests" onto a day on a computer)
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
  Calendar's Held view: Hold longer (see "Rental extras": 3 days, or the days she types), Keep
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
  7 AM Memphis every day: Valerie's to-do email (Your week on Mondays).
- **Guard**: `npm run validate:request-form` and `npm run validate:request-messages` (in `validate:admin`).

## Requests on a phone (owner, 19 Oct 2026)
The request list comes right after the heading and a one-line week card ("Latest: <name>" with
"N NEW"). Tomorrow's reminders are one tappable line at the bottom ("3 reminders ▸"). The
three-step panel sits under the list on a phone, on top from 900 px. Each new website request
wears **NEW** until Valerie taps it, opens More / Edit / any button on the card, arrives
from the New-request email link, or acts on it (status, invoice, put away). Opened is stored in
`request_opened` (migration 0016, every older request backfilled as opened); the rule is
`functions/_lib/request-new.mjs` (`npm run validate:admin-requests-phone`).

## Step cards, tentative -> confirmed, invoice quick-adds (owner-approved 19 Oct 2026, migration 0018)
- **Step cards** (`requestCard` in `views.mjs`, rules in `functions/_lib/steps.mjs`): NEW, service,
  name, one date line; a green bar, "N of M done" and the named steps (done = green ✓, current
  bold, later grey) with ONE "undo" beside the last ✓; then ONE "Next step · step N" box (one
  sentence, one big button, small Call / Text where useful). Everything else (answers, phone and
  email, ID, notes, history, Edit, Add a note, Print checklist, Put away, the Payment box, the
  other buttons, Void) is under "More: answers, history, other buttons".
  - Rentals: Called back -> Invoice sent ("Review & send invoice" opens the website's draft in the
    editor) -> Deposit paid ("Games held until <time>" + "Hold longer" holding the hold controls)
    -> Picked up ("Mark picked up", with "They paid the rest now" ticked when money is owed) ->
    Returned -> Deposit given back ("Deposit returned, finish" records the refund; "Keep some for
    damage" opens the invoice). A rental picked up with money still owed gets "Paid in full" too.
  - Party & decor / Porch / Grazing: Called back -> Invoice sent ("Create invoice") -> Deposit paid
    -> Setup done (porch: Install done) -> Takedown done (or "Not needed"; grazing: Pickup,
    optional) -> Paid in full.
  - Every step is DERIVED (invoice sent, payments on Money, job_done_at, bookings.done_at, the
    check-in, the takedown, damage-deposit refund/kept rows), so doing it anywhere ticks it. Only
    "Called back" and the "Yes, book it" answer are stored: `request_steps` (migration 0018,
    additive; requests already Scheduled were backfilled as called + confirmed). The next step is
    the first one not done, except on the job's own day (setup / pickup), when the job comes first.
  - Undo: a tap on the card is taken back there (Called back, Setup done, Takedown / Pickup done or
    not needed, Picked up, Returned via the check-in); a money or invoice step only explains where
    to change it (the invoice / Edit page). Nothing deletes a payment or an invoice.
- **"I've talked to them"** asks "Are you taking this job?": **Yes, book it** (the day(s) editable
  right there; books the install / setup or the rental pickup + return as her bookings, books the
  form's takedown day, keeps a held rental held with no end time), **Not yet** (called only; "Not
  booked yet: Book it now" stays on the card), **No, put it away** (puts it away, frees held games).
  Routes: `functions/_lib/admin-steps.mjs` (`/admin/requests/talked`, `/called`, `/note`);
  `/admin/calendar/bookings/:id/done` marks a takedown, grazing pickup or rental pickup done.
- **Tentative -> confirmed** (`steps.mjs isConfirmed`, the one rule): confirmed = "Yes, book it",
  a booking she made from the request (Book it / drag / the booking screen), a phone request, money
  in, or the job done. Until then every date of the request is an OUTLINED "Requested · not
  confirmed" chip (held rentals: "(games held)"; their games still count as out), on the month,
  the phone day list, Upcoming (now with requested days), the list view and the Day sheet. The
  Calendar's **Unconfirmed requests** list (was "Unscheduled requests") shows each with its
  "Asked for <day>" chip (opens that month), Open the request and Book it; the Monday summary has
  "Unconfirmed requests" under Needs you (redeploy the mailer after a change).
- **Dates without a year** (`calendar.mjs parseFormDate`): "11/3", "11-3", "Nov 3", "November
  3rd", "Tue 3 Nov"... read as the next 3 Nov on or after today (Memphis); the engine's Date.parse
  is only used with a four-digit year (it picked 2001). The 19 Oct report ("3 Nov request shows as
  unscheduled, no chip"): the answer was stored right (2026-11-03) and its chip was on November,
  but October's month (grid and phone list) stops at 31 Oct, Upcoming listed only bookings, and the
  old list gave no date; Upcoming and Unconfirmed requests now show it.
- **Invoice quick-adds** (`invoiceEditorPage`): + Delivery fee, + Discount (she types it, kept
  negative), + Setup / takedown fee, + Damage deposit (refundable), and on a rental + Extra game:
  the games free for the whole pickup -> return span (booked or already-in-the-rental ones
  disabled), "Complimentary (no charge)" -> a $0 line (note `free`) + the invoice note
  "Complimentary Nth game: <game>". Prices: `data/offers/services.json invoiceQuickAdds` only.
  Paid or free, the game is written onto the rental's bookings as "<game> (extra game)"
  (`functions/_lib/extra-games.mjs syncExtraGames`, on every invoice save / send / texted), so
  availability, the calendar, the Day sheet and the clash checks count it; removing the line frees it.
- Proof: `npm run validate:admin-step-cards` (in validate:admin).

## Money tab (calm layout, owner-approved 19 Oct 2026)
- **Order**: the big numbers (Money in, Still owed, Tips, Expenses, Left after expenses; plus
  "Expected if confirmed" when ticked), then **Not paid yet**, then Jobs, Tips, Expenses, and
  "More numbers" (by service, deposits held, requests this month, month by month, taxes).
- **View** (kept in the URL): `By month` (`?month=YYYY-MM`, ‹ ›, this month by default) or
  `All jobs` (`?view=all`: Upcoming nearest first, then Past newest first). A job row shows name,
  service chip, date, total, paid, still owed, tips (`jobRows` / `viewRows` in `money.mjs`).
- **Include unconfirmed jobs** (`unconf=1`, default off): requests not confirmed by the rule in
  `steps.mjs` show dashed, "Not confirmed"; their invoice charges go only into "Expected if
  confirmed", never into Money in or Still owed.
- **Leave out refundable deposits** (default on; `deposits=in` turns it off): Money in = charges
  received + deposits kept for damage; off, everything received, labelled "deposit (given back
  later)". A deposit is never owed.
- **Tips** (table `tips`, migration 0019): "+ Record a tip" (amount, date, Cash / Zelle / Cash App /
  Other, optional recent job, note). Never a payment, never on an invoice or in its balance, never
  owed; on the job row, the request card history and the Monday summary ("· tips: $X").
- **Expenses**: "+ Add an expense" (by hand) and "Upload a receipt" (read by Workers AI, checked
  and saved by her; "Check N receipts" while any wait). Tip and expense changes are kept in
  `money_history` and shown under History. `npm run validate:admin-money-calm` proves all of it.

## Calm calendar: Calendar & Bookings for laptop and phone (owner-approved mock-up, 19 Oct 2026)
- **Computer (900 px and up)**: the month grid comes first and largest (service colours + words;
  not confirmed = a dashed outline reading "? Party: Name", a held one "? (games held) ..."; the
  colour key and "Filled = booked · Outlined = requested" legend above it). The right margin
  column holds the numbered steps in the owner's words (`STEPS.calendar` / `PANELS.calendar` in
  `functions/_lib/helptext.mjs`): 1 See what's coming up (the Find a customer box, submitting to
  `/admin/search` with live results; Every booking as a list; Link my Google Calendar) · 2 Put a
  request on the calendar (Unconfirmed requests, Takedowns to schedule, Still to decide, Add a
  booking; drag a request or a booking onto a day still works) · 3 Plan your day (today's count,
  Today's list) · 4 Check tomorrow's reminders (who, what, time, Text reminder / Email them / Mark
  reminded, sent ✓). Step 5 Look over the next 14 days (the old Upcoming list) sits under the
  month. "Every booking" (the old List view, past bookings one tap away) is a section at the
  bottom; the List button and Step 1's link jump to it. Alerts (holds ending soon, overdue
  returns, double-booked) stay above everything.
- **Phone (under 900 px)**: Step 1's search at the top; a small month with one coloured dot per
  job (hollow = not confirmed); tapping a day shows that day's jobs right under the month (every
  day has a panel, `data-month-day`, one shown; default today). Tapping a job opens its details:
  time, where, games / what to bring, what is left to collect or Paid in full ✓, the deposit, a
  hold or note, with Call, Text and Open their card (Open the day sheet below). Steps 2-5 are
  numbered rows with a chevron, holding the same content as the computer. No dragging on a phone.
- **Yes, book it on the calendar is the Requests card's own action**: `bookYesForm` in
  `functions/_lib/views.mjs` builds the one form (the card's talk box and the calendar both call
  it) and `POST /admin/requests/talked go=yes` books + confirms. On the calendar (Step 2 and an
  unconfirmed job on a phone's day) it opens to the day(s) prefilled with the requested day, then
  "Book it"; `back=/admin/calendar?month=YYYY-MM` (only that shape is followed,
  `admin-steps.mjs calendarBack`) brings her back to "✓ Booked Name: ..." with the chip solid and
  the request off Unconfirmed requests. Takedowns to schedule: "Schedule takedown" -> the day ->
  "Book takedown" (the card's `/admin/requests/takedown-inline`), "Not needed" (the card's
  `/admin/requests/takedown plan=customer_handles`); "More choices" opens the full booking screen.
- Code: `calendarPage` and `CALM_CSS` in `functions/_lib/views-calendar.mjs`; data in
  `functions/_lib/admin-calendar.mjs calendarPage`. Help text for every new control (`cal.stepRow`,
  `cal.pday`, `cal.pjob`, `cal.jobText`, `cal.daySheet`, `cal.yesOpen`, `cal.bookYes`, `cal.tdOpen`,
  `cal.tdBook`, `cal.tdNotNeeded`, `cal.everyBooking`).
- Proof: `npm run validate:admin-calm-calendar` (in validate:admin): month before the steps,
  steps 1-5 in the owner's words, the search in Step 1, the phone month + day panel + job details,
  Yes, book it = the card's form and lands back solid, dashed vs solid, the takedown buttons, and
  everything the page had before (every-booking list, drag, Add a booking, Day sheet links).
## Rental extras (owner, 19 Oct 2026)
- **Rental invoice note** (`functions/_lib/invoice-note.mjs`, one function): money left after the
  amount due now -> "Pay the rest ($R) at pickup. Text or call 901-355-1518 to set your pickup time
  at Mt. Moriah Station unless otherwise agreed upon."; nothing left -> "This covers everything.
  Nothing more to pay at pickup. ..."; paid in full -> "Paid in full. Thank you! ..." on the ONLINE
  invoice page only (no email or extra invoice is ever sent for it). Business delivery (the
  request's tick or a Delivery fee line): "at delivery" and "Text or call ... to set your delivery
  time unless otherwise agreed upon." R = total minus the amount due now (or paid, if more); the
  amount due now takes the refundable deposit first, so an uncovered deposit is never "owed". Phone
  and place from games.json `pickup`. A note Valerie typed wins (the automatic one is left out);
  the website's old draft note does not count as hers. New website drafts carry no note of their
  own. Nothing stored is rewritten: sent invoices keep their stored notes and lines.
- **Business delivery** (`scripts/lib/business_delivery.js`): "Renting for a business? We can
  deliver to your business for $20." on /rentals/ (Where, the pickup FAQ, How pickup works), the
  FAQ rentals section, /rules, llms.txt and /request; the price is `data/offers/services.json
  invoiceQuickAdds.deliveryFee` (the invoice quick-add's). /request rentals: a tick box "This is
  for a business — deliver to us ($20)" revealing Business name + Delivery address (both required
  when ticked; answers "Business delivery", "Business name", "Delivery address"). Ticked: the draft
  invoice gets the "Delivery fee" line, the card shows "Business delivery: <business>, <address>",
  the pickup / return bookings are at that address and read "Delivery" / "Collect" on the
  calendar, Upcoming, the list and the Day sheet (`calendar.mjs deliveryAddress / rentalPlace`).
  Home rentals stay pickup and return at the safe exchange zone. Facebook listings are hand-written:
  add the same sentence there.
- **Holds**: 48 hours from the request by default, "Hold longer" = one button, then a days box
  prefilled 3 + Hold: each press adds 3 days (or exactly the days typed) on top of the CURRENT end
  time, repeatable, each logged; the card says "Games held until Wed 3 PM" and then "Held until
  <new time> ✓". No 24 / 48 h menus. Numbers: `data/offers/services.json rentalHolds`
  (`functions/_lib/hold-rules.mjs`); the public pages read the same. Existing holds are untouched.
- **Waiting N days** on step 1 of a card ("Sent today", "Waiting since yesterday", "Waiting N
  days", red from 3): Memphis calendar days (`steps.mjs waitingDays / waitingWords`).
  `functions/_lib/callback-list.mjs callbackRows` lists every request still waiting for a call
  (not phone, not put away), oldest first, for a later daily email (not sent yet).
- **Invoice editor**: compact rows (what · qty × price · total; tap to change in place), the
  quick-adds as one row of chips (+ Line first), the pay plan, an optional message, ONE summary at
  the bottom and ONE big "Send invoice" (Save draft and See it before sending small).
- Proof: `npm run validate:admin-rental-extras` (in validate:admin).

## Quote form contract (rentals v3, owner-approved 15 Oct 2026)
Legacy intake: the site's /request form replaced it and takes its choices from the live inventory.
Old answers keep these strings forever, so each must still name an item (available or removed)
or a bundle in games.json (`npm run validate:admin-prices`). The Google Form is rebuilt by hand; the admin prefill maps these exact strings
(`formChoice` in `data/rentals/games.json`). `npm run validate:admin-prices` reads this list and
fails if a string is missing from the data, maps to the wrong price, or names a hidden item.

"Which games?" (checkboxes):
- `Giant Connect Four`
- `Cornhole set`
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

## Rental dates (owner, 19 Oct 2026)
The website form (`/request`, rentals path) asks "What date is your event?", then "How long?":
`One day` or `The entire weekend (Fri, Sat and Sun)`, then the pickup and return days:
- One day: pickup "The day before" or "The morning of"; return "The day after" or "2 days after".
- The entire weekend (the Fri-Sat-Sun holding the event date; a Monday-Thursday event is refused):
  pickup "Thursday" or "Friday"; return "Monday" or "Tuesday".

Prices never change with the days: one day is the day price, the weekend the weekend price
(`data/rentals/games.json`). The days are computed in ONE place, `rentalSpan` in
`functions/_lib/calendar.mjs`, and stored as the "Pickup date" and "Return date" answers. The
games count as out every day from pickup through return (availability, clash checks, holds).
The calendar shows the pickup chip, a striped "Rental out" chip on each day between, and the
return chip (outlined "Requested" chips for an unpaid request); the Day sheet and the Monday
summary list "Rental out" too. Edit (Bookings) has "Rental dates": both days in one Save, history
old → new, and a plain warning naming the game and dates when the span clashes (it still saves).
`npm run validate:rental-dates`. The Google Form strings above are the one imported old request.

## Inventory (owner-approved 18 Oct 2026; its own page 19 Oct 2026)
Valerie adds, edits, removes and brings back rental items on **/admin/inventory** (main nav
"Inventory", the Settings "Inventory" section's Open Inventory button, the Day sheet games grid).
Old addresses redirect: `/admin/settings/inventory[/new|/<slug>]` -> `/admin/inventory[/new|/<slug>/edit]`
(their saves still work), `/admin/settings#inventory` lands on the page. The page's address is
`INVENTORY_HOME` in `views-inventory.mjs` (moving it is that line plus the nav link in `layout()`).
- **Two separate ideas, never both called "available"** (owner, 19 Oct 2026): **Offered / Not
  offered** is set by hand (Remove / Bring back); **In / Out** is computed from the bookings. Each item
  shows one pill: "In" (green) · "Out: <First L.>, back <Tue 20 Oct>" (blue; "was due back" when
  overdue and not checked in) · "1 of 2 out" (multi-set items) · "On hold until <Memphis time>"
  (amber; a website hold not paid yet; "until you decide" when held by hand) · a small "Next booked:
  <range>" line · "Not offered" (grey, its own group at the bottom with Bring back, never In / Out).
  Tap an item -> `/admin/inventory/<slug>`: its upcoming bookings (each with Open that day), then
  Edit / Remove / Bring back. Code: `itemStatuses` in `functions/_lib/inventory.mjs`, built on
  `rentalWindows` / `isOut` (calendar.mjs): the whole pickup -> return span, held or confirmed.
- **One matcher.** Booking words are matched to items by `expandItems` (`namesItem`/`matchText` in
  calendar.mjs): the inventory name anywhere in the words, any case, punctuation or spacing, other
  words ignored (the 19 Oct production booking "Giant Uno, Grab the Mic, Inflatable Movie Screen,
  Projector, movie night bundle for $110 + $50 deposit refunded on tuesday"). The /request
  availability answer, the booking picker, the clash checks, the calendar, the Day sheet and
  Inventory all read it, so a customer can book an item only when it is offered AND not out on their
  dates. `npm run validate:admin-inventory-status` (in validate:admin) compares Inventory's Out with
  the availability answer and the clash check for every item over 24 days.

## Settings (calm layout, owner 19 Oct 2026)
Short sections, each opening with one sentence, folded on a phone and open on a computer
(`SETTINGS_SECTIONS` in views.mjs): Your payment details · Emails & reminders (day list, Monday
summary, rental holds) · Inventory (Open Inventory) · Google Calendar link · Website auto-update
status (the Inventory page's "Website updating… / Live ✓" box) · Google Sheet · Expense categories ·
Password. Every form, field and button that was there is still there and saves the same way
(`validate:admin-inventory-status` lists them).

## Inventory: how it is stored and published Code: `functions/_lib/inventory.mjs`,
`functions/_lib/views-inventory.mjs`; rules: `scripts/lib/inventory.js` (the same `validate()` CI runs).
- **One source of truth.** D1 (`inventory_items`, migration 0013) is the live copy, seeded from
  `data/rentals/games.json` on first use. Every admin page, the /request form, its availability
  answer and the Monday summary read it straight away (`useInventory`). Each save is published back
  into `games.json` by the **Inventory Publish** workflow (apply -> `npm run inventory:regenerate`
  in the regenerate order, refreezing only the frozen pages it changed -> `validate:release` ->
  push), which Cloudflare Pages deploys. Public pages stay pre-rendered.
- **How a save reaches the website.** The **Inventory Poll** workflow (every 5 min) reads
  `GET /api/inventory/pending` and starts Inventory Publish once per change with GitHub's own token.
  Optional Pages secret `PNP_GITHUB_TOKEN` (Actions: write on seq23/p-n-p) starts it instantly.
  The workflow reports back to `POST /api/inventory/report` (HMAC, `PNP_INVENTORY_REPORT_KEY` on both
  GitHub and Pages). Inventory (and Settings) show "Website updating…", then "Live ✓" only when
  porchandparty901.com/rentals/ carries the new `<meta name="pnp-inventory">` version; a failure
  says so in plain words with **Try again**.
- **Remove is soft** (`availableNow: false`, shown as Not offered): off the website, /request, availability and the
  booking picker; old bookings keep it on their Day sheet and edit form; invoices keep their lines.
  Remove says how many future bookings have it. **Show on website** off = admin only (like the
  Projector): tracked, never priced or public.
- **Bundles.** Whole Yard and The Whole Party (`allGames`) take every available public game at its
  quantity and say "All games (available now: N)"; a bundle whose items are gone, or that would cost
  more than the items, comes off by itself (`offBecause`). Every game shares the game price (its own
  form in Inventory); an item may carry its own refundable deposit (one per order, the biggest).
- **Photos** are shrunk to 1200x900 on the phone, EXIF-stripped on the server, kept in
  `inventory_photos`, and converted to `assets/rentals/<slug>.webp` by the workflow.
- Scenario validators run on `scripts/validators/fixtures/games.json` (the seed); the live file is
  held to the rules by `validate:admin-inventory` and `validate:rentals`. Facebook listings are
  hand-written: after an inventory change, `validate:rentals` lists the lines to update on Facebook.

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

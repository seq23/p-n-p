# Corporate request and outreach operation

The request form offers Home and Business or lobby. Only the latter stores `corporate=1`;
old requests remain home requests. Admin cards and matching owner-feed entries carry a
Business / lobby label. Already-sent invoice copies remain unchanged.

The private Pages API accepts `Authorization: Bearer <PNP_OUTREACH_TOKEN>`:

- `POST /api/outreach/send`: `prospect_id`, `to`, `subject`, `text`, optional `in_reply_to`.
- `GET /api/outreach/status?since=YYYY-MM-DD`: daily first sends and follow-ups, suppression
  and takeover addresses, reply classifications, paid corporate count and stop reason.

First sends and follow-ups have independent caps of 15 per America/Chicago day. Atomic
D1 reservations count against each cap until a delivery is confirmed. An uncertain send
keeps its slot and prospect lock: inspect delivery records before any manual recovery.
A follow-up requires the first message's returned ID, the same recipient and prospect,
`Re: <original subject>` and at least five days. Only one follow-up is possible.

The campaign stops after December 5, 2026 (Memphis time), or at four distinct corporate
requests with a November/December 2026 event and actual, non-voided payments covering the
invoice deposit. Test requests and void invoices do not count. Zero-deposit invoices count
only when fully paid. Event dates can come from the form or a scheduled setup/install/pickup.

The D1 `settings` key `outreach_do_not_contact` holds a JSON array of domains and company
names. Keep real entries in deployment data only. Missing or invalid configuration refuses
sends. Suppressed addresses/domains and taken-over companies are also refused. Company
names are compared with the supplied prospect, subject, message and domain. The caller
must retain the company name in the approved subject and supply only the approved copy.

Inbound mail enters the mailer's `email()` handler. It archives the original MIME in
private R2 (`OUTREACH_RAW`, the existing private bucket, prefix `outreach/raw/`) and records
`outreach_inbound`. Confirmed DSNs suppress contacted failed recipients, rather than the
mail server. Clear opt-outs suppress the sender. Clear automatic replies are filed.
Questions, interest, unclear replies, HTML-only responses and uncorrelated DSNs forward
unchanged to the configured owner. Takeover is recorded before forwarding to prevent a
send while a failed forward is retried. A storage outage attempts forwarding and surfaces
the failure. No inbound record is added to the admin's customer-request or task lists.

Sending: the send endpoint calls the Resend API (`https://api.resend.com/emails`) with the
Pages secret `RESEND_OUTREACH_KEY`, never pnp-mailer (pnp-mailer does not allow the sequoia@
sender). Every message is multipart text + HTML from and Reply-To `sequoia@porchandparty901.com`,
with our own `Message-ID` (returned as `message_id`; a follow-up passes it as `in_reply_to` and is
sent with `In-Reply-To`/`References`), a `List-Unsubscribe: <mailto:…?subject=remove>` header and
the owner's footer in a small grey line: `Porch & Party 901 · {mailing_address} · Don't want these
emails? Reply "remove" and we'll stop.` The mailing address is the D1 setting
`outreach_mailing_address`; without it every send is refused. Replies of "remove", "unsubscribe" or
"stop" (or an empty reply with that subject, from the List-Unsubscribe mailto) are opt-outs.

Secrets: Pages `PNP_OUTREACH_TOKEN` (shared with Boss OS; local copy `~/.boss-os/pnp-outreach-token`,
mode 600) and `RESEND_OUTREACH_KEY`; Worker `pnp-mailer` secret `PNP_OUTREACH_OWNER` (the owner's
forward address). Without `PNP_OUTREACH_OWNER` inbound mail is rejected back to the sender, never
filed. Deploy the Worker with `npm run mailer:deploy`, never a bare wrangler deploy.

Before activation, apply additive migration 0026 and configure the production do-not-contact
setting only with explicit authorization to write production D1. Verify the owner's Email
Routing destination and create a literal `to` routing rule to Worker `pnp-mailer`. This needs
Cloudflare `email_routing:write`. If the destination is unverified, register it through
Cloudflare and have the owner click the verification link. Do not send outreach to test it.

Validation: `npm run validate:corporate-outreach` uses in-memory SQLite and fake mail, R2 and
forward bindings. It runs within `npm run validate:release`. A production smoke check may
POST an empty unauthenticated request and must receive 401; never POST a recipient.

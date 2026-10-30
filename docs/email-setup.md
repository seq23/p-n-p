# Email setup: hello@ and sequoia@porchandparty901.com (30 Oct 2026)

Where every Porch & Party email address lives, how it sends, how it receives, and what to check
when something stops working. Owner-approved 30 Oct 2026. No secret values in this file; keys live
in Resend, Cloudflare secrets and the owner's vault.

## The addresses

| Address | Who uses it | Receives into | Sends from |
|---|---|---|---|
| `hello@porchandparty901.com` | Valerie, and the system (invoices, reminders, the 7 AM email) | Valerie's Gmail (Cloudflare Email Routing) | Valerie's Gmail "Send mail as" via Resend SMTP; the system via `workers/pnp-mailer` (Cloudflare `send_email`) |
| `sequoia@porchandparty901.com` | The owner, and Camille's holiday office outreach | The owner's Gmail (Cloudflare Email Routing; once the outreach build lands, through the `pnp-mailer` inbound filter, which forwards every real reply) | The owner's Gmail "Send mail as" via Resend SMTP; Camille via the Resend API |

Signature on every P&P email sign-off: **Porch & Party 901**.

## Receiving (Cloudflare Email Routing)

Cloudflare dashboard → porchandparty901.com → Email Routing → Routing rules. One rule per address.
Both personal Gmail inboxes are verified destination addresses on the account. Catch-all is off (Drop).

## Sending from Gmail (Resend SMTP)

Gmail → Settings → Accounts and Import → "Send mail as" → the P&P address → edit info:

- SMTP server `smtp.resend.com`, port `465`, SSL, username `resend`
- password: the Resend API key **pnp-gmail-smtp** (sending access only, limited to porchandparty901.com)

Resend account: the **cryptoclearr** Resend team (free plan: 3 domains, 3,000 emails/month and
100/day shared with its other two domains). porchandparty901.com is its third domain.

**Why not smtp.gmail.com:** mail Gmail sends for a custom domain is signed as gmail.com, so it
can never pass this domain's strict DMARC (`p=reject`) and is rejected or spam-foldered. Resend
signs as porchandparty901.com, so it passes. Verified 30 Oct 2026: `dkim=pass header.i=@porchandparty901.com`,
`spf=pass`, `dmarc=pass`.

## DNS (Cloudflare, porchandparty901.com)

| Record | Value | Purpose |
|---|---|---|
| `TXT @` | `v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all` | SPF |
| `TXT _dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=…cloudflare` | Strict DMARC, reports to Cloudflare DMARC Management |
| `TXT cf2024-1._domainkey` | Cloudflare DKIM | pnp-mailer |
| `TXT resend._domainkey` | Resend DKIM public key | Gmail send-as + Camille |
| `CNAME send`, `CNAME rsend` | `send.forge.rmta.net`, `rsend.forge.rmta.net` (DNS only) | Resend return path |
| `MX @` | `route1-3.mx.cloudflare.net` | Email Routing |

Never relax DMARC to fix a delivery problem; check that the sender goes through Resend instead.

## Cold outreach

The 22 Oct 2026 rule in `docs/outreach-sending-plan.md` (cold mail only from a separate subdomain
and account) was **retired by the owner on 30 Oct 2026**. Camille's holiday office outreach sends from
`sequoia@porchandparty901.com` through the Resend API (Pages secret `RESEND_OUTREACH_KEY`), not through
pnp-mailer, so the invoice sender's quota is never shared with cold mail. Limits, stop rules and the
do-not-contact list are enforced in the outreach endpoint (`functions/api/outreach/`).

## When something breaks

- **A test lands in spam:** blank "test" emails from a new address often do. Check the headers
  (Gmail → ⋮ → Show original): if SPF, DKIM and DMARC say PASS, the setup is fine; mark "Not spam".
- **DMARC FAIL in the headers:** that Gmail "Send mail as" entry is pointing at smtp.gmail.com again;
  set it back to smtp.resend.com as above.
- **Resend says the key is invalid:** create a new sending-only key for porchandparty901.com in the
  cryptoclearr Resend team and paste it into both Gmail "edit info" boxes and `RESEND_OUTREACH_KEY`.

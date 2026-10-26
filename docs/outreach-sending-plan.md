# Outreach sending plan: cold email off the invoice domain (22 Oct 2026)

Cold outreach (hotels, HOAs, schools) must never send from the domain, the mailbox or the sending
account that carries invoices, reminders and Valerie's 7 AM email.

## What sends today (checked 22 Oct 2026)

- `workers/pnp-mailer` sends everything through **Cloudflare Email Service** (Workers `send_email`
  binding `EMAIL`, `allowed_sender_addresses = ["hello@porchandparty901.com"]`), on the account's
  Workers Paid plan: 3,000 sends a month included, then $0.35 per 1,000; one daily quota per
  Cloudflare **account** that starts conservative and grows.
- DNS on `porchandparty901.com`: SPF `v=spf1 include:_spf.mx.cloudflare.net ~all`; DKIM
  `cf2024-1._domainkey`; bounce subdomain `cf-bounce`; Email Routing MX `route1-3.mx.cloudflare.net`;
  DMARC `p=reject; sp=reject; adkim=s; aspf=s` (rua to Cloudflare's DMARC reports).
  `sp=reject` means any new subdomain must pass its own SPF/DKIM alignment or it is rejected.

## Decision: not Cloudflare Email Service for cold outreach

- Cloudflare positions Email Service for transactional mail (triggered by the recipient's own
  action); marketing / bulk campaigns are not what it is for, and its compliance terms require
  CAN-SPAM unsubscribe handling the mailer does not have.
- A subdomain separates **domain** reputation only. The quota, the suppression list and the
  account's standing are per Cloudflare **account**: complaints from cold mail would throttle or
  suspend the same account that sends invoices and the 7 AM email. That is the exact coupling this
  plan exists to remove.
- So the outreach subdomain goes to a separate sending service, on a separate account.

## The plan

1. **Subdomain:** `outreach.porchandparty901.com`; From `Valerie at Porch & Party
   <hello@outreach.porchandparty901.com>`, Reply-To `hello@porchandparty901.com` (replies still reach
   her through Email Routing; the reply domain is never the sending domain).
2. **Sending service:** a free plan on a separate account (first choice Brevo Free: 300 sends/day,
   own domain authentication, built-in unsubscribe link and list). $0, but it is a new account in
   the business's name, so it is created by the owner (named stop below).
3. **DNS on `outreach.porchandparty901.com`** (Cloudflare DNS, all DNS-only / grey cloud), using the
   exact values the service shows at domain authentication:
   - SPF: `TXT outreach  "v=spf1 include:<service SPF host> ~all"` (Brevo: `include:spf.brevo.com`);
   - DKIM: the service's selector records (Brevo: `CNAME brevo1._domainkey.outreach` and
     `brevo2._domainkey.outreach` to the values it gives);
   - domain verification: the service's `TXT outreach "<code>"`;
   - DMARC: `TXT _dmarc.outreach "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:<the Cloudflare
     rua address already used on the apex>"` (quarantine, not reject, during warm-up; move to
     `p=reject` after 4 clean weeks);
   - no MX on `outreach` (nothing receives there; replies go to the apex).
   The apex records above stay exactly as they are.
4. **Limits and warm-up** (per sending day, Mon-Fri, business hours Memphis):
   - week 1: 10/day; week 2: 20/day; week 3: 35/day; week 4+: 50/day, never above 50 while cold;
   - hard stop for the day at bounce rate > 3 % or any spam complaint; pause the list on 2 complaints
     in a week;
   - every email: one recipient, plain text-first, the business's postal address and a one-click
     unsubscribe (CAN-SPAM), no attachments, no link shorteners, links only to porchandparty901.com
     with `?src=hotel|hoa|school` so each request is tagged (`requests.source_tag`, migration 0023).
5. **Proof once live:** a test send to a Gmail and an Outlook mailbox shows `spf=pass`,
   `dkim=pass header.d=outreach.porchandparty901.com`, `dmarc=pass`; mail-tester.com ≥ 9/10; the
   apex's own 7 AM email still passes DMARC the same day.

## Named stop

Setting up the sending account is the one step an agent cannot do: it is a new account in the
business's name (signup, email confirmation, terms). Agents never spend money; this plan costs $0.
Once the account exists and its API key is in the vault, an agent adds the DNS records above with the
Cloudflare token, verifies, and runs the warm-up.

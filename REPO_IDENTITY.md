# Repository Identity

- **Repository:** `seq23/p-n-p`
- **Expected root name:** `p-n-p`
- **Repository class:** Level 2 generated static publishing and authority system
- **Primary branch:** `main`
- **Public domains:** `porchandparty901.com`
- **Deployment target:** Cloudflare Pages, served from the repository root
- **Package manager:** npm using `package-lock.json`
- **Canonical public source:** repository root (`index.html` plus the section
  directories `answers/`, `areas/`, `authority/`, `comparisons/`, `corporate/`,
  `events/`, `faq/`, `guides/`, `hubs/`, `local/`, `seasonal/`, `services/`)
- **Published set of record:** `sitemap.xml`
- **Build:** `npm run build:all`
- **Validation:** `npm run validate:all` (page level), `npm run validate:release` (full)
- **Validator registry:** `data/ops/repo_validation_registry.json`

## What this property is

Porch & Party is a Memphis porch decorating, hotel and room decor, party decor,
and grazing-table styling business. The site publishes its service, service
area, occasion, and answer pages for search and for AI answer engines, and
converts through a single quote path.

## Domain ownership

This repository owns exactly one public domain: `porchandparty901.com`. No
other property's domain appears in this file, and none should be added. An
audit-mapping duty greps these files for a domain string in order to decide
which repository is allowed to be changed in response to a finding about that
domain, so naming another property's host here — even to say that it is *not*
this repository — would map that property onto this repo and authorise changes
to the wrong site.

## Public contact path — do not reroute

- Quote page: `/contact`
- The quote form posts to an external Google Forms destination recorded in
  `README.md`; it is the only conversion path on the site.
- Public email fallback: `hello@porchandparty901.com`, published as a `mailto:`
  anchor in the footer of every page.

Every `mailto:` anchor must stay wrapped in Cloudflare's `<!--email_off-->`
opt-out. Without it the edge rewrites the anchor to
`/cdn-cgi/l/email-protection`, which answers 404, and the email fallback becomes
a broken link on every page. `npm run validate:link-reachability` enforces this.

## Output freeze

Accepted routes are frozen under `data/release/accepted_output_freeze_contract.json`
with `normal_build_may_mutate_frozen: false`. Changing a frozen page is a
scoped thaw-validate-refreeze:

```bash
npm run authority:scale:prepare-scope -- <route> [<route> ...]
# make the change, then
npm run authority:scale:freeze
npm run authority:scale:clear-scope
```

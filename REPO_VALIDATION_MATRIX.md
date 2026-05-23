# Repo Validation Matrix — Porch & Party 901

Status: ACTIVE
Scope: simplified static-site validation only
Goal: keep the repo shippable without turning local SEO iteration into validator hell.

## Validation Philosophy

This repo is a small static local-service site. Validation should protect only the things that can break indexing, navigation, deployment, or legal/footer trust. It should not hard-fail on subjective copy length, exact section wording, aesthetic preference, or future content ideas.

## Matrix

| Validator / Test | Command | Severity | Production Risk | What It Proves | What It Does Not Prove | Failure Handling |
|---|---|---:|---|---|---|---|
| Core static site validator | `npm run validate:all` | HARD FAIL | Missing critical files, broken internal links, missing title/canonical/schema, bad sitemap coverage, missing legal footer | Repo has required files, pages have indexable metadata, internal links resolve, sitemap matches HTML files, and LLM files mention porch decorating, hotel/party decor, and grazing table setups | Search ranking, conversion rate, Google Business Profile strength, visual quality | Fix exact missing/broken file or link |
| Build generator | `npm run build:all` | HARD FAIL when generator output is changed | Generated pages or sitemap cannot be rebuilt | Generators run and sitemap updates | Browser rendering, Google/LLM ranking | Fix generator/data error |
| Manual browser review | local preview / deployed preview | STRONG WARNING | Major layout or trust issues may go unnoticed | Human can inspect homepage, pricing, porch service, one area page, one answer page | Automated proof | Owner/operator review before major launch |
| Image provenance / gallery claims | content review | HARD FAIL only for false “real project” claims | Misleading users by implying illustrative images are completed client work | Copy avoids false project-photo claims | Image quality or authenticity | Remove false claims or replace with real project photos later |
| GBP / reviews / off-site citations | outside repo | NOT VALIDATED HERE | Off-site authority is required for local dominance but not controlled by repo | Not applicable | Everything outside the repo | Owner handles manually |

## Simplification Rules

- Hard-fail only: broken files, broken links, missing core metadata, sitemap drift, missing footer/legal identity, malformed schema JSON, or missing the three core service categories from LLM surfaces.
- Warning-only: word count, exact title length, subjective copy, content expansion backlog, visual polish, image variety.
- No Playwright requirement for this repo unless interactive forms are moved on-site.
- No deep validation requirement for this repo unless the stack becomes dynamic/authenticated.


## Dual-category authority preservation

The site is intentionally optimized for both primary service families:

1. Seasonal porch decorating / front porch styling.
2. Party decor / celebration setups / hotel-room decor / grazing-table styling.

Validation should confirm both service families remain present in indexable surfaces, but it must not enforce brittle exact copy, arbitrary word counts, or subjective SEO preferences.

| Validator / Test | Command | Severity | Production Risk | What It Proves | What It Does Not Prove | Failure Handling |
|---|---|---:|---|---|---|---|
| Dual service LLM surface check | `npm run validate:all` | HARD FAIL | The site may become porch-only or party-only in machine-readable extraction files | `llms.txt` keeps porch decor, party decor, hotel-room decor, celebration setup, grazing table, and pricing signals | Ranking, off-site authority, review velocity | Restore missing service family language |
| Party service page presence | `npm run validate:all` | HARD FAIL | New party decor surfaces may be accidentally deleted | Core party decor, hotel-room decor, birthday decor, shower decor, grazing-table, budget/luxury party pages exist | Content quality, conversion performance | Restore required page or remove requirement with owner approval |
| Visual image variety | content review | WARNING | Images may feel repetitive | Hyperlocal readable image filenames exist | Real project portfolio proof | Replace illustrative assets with real project images over time |

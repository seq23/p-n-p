# Artifact Manifest

- Artifact: p-n-p-main_BASELINE_07-22-26_<sha12>.zip
- Repo: p-n-p-main
- Packaged root: p-n-p-main
- ZIP root layout: repo wrapper folder at archive root
- Mode: full baseline snapshot
- Date: 2026-07-22
- SHA-style suffix: assigned after packaging
- Source basis: uploaded `p-n-p-main(1).zip` plus PNP local authority contract upgrade
- Validation run on this source tree: `npm run validate:pnp-phase`
- Packaging validation: ZIP reopened and root files verified after packaging
- Updater target: generic v3 snapshot updater
- Status: STRUCTURALLY CHECKED — LOCAL VALIDATION REQUIRED

## July 22, 2026 local authority contract upgrade

- Added `data/ops/pnp_local_authority_contract.json`.
- Added `docs/day-0/START_HERE.md`.
- Added non-mutating validators:
  - `scripts/validation/validate_profile_purity.js`
  - `scripts/validation/validate_tree_hygiene.js`
  - `scripts/validation/validate_local_authority_contract.js`
- Added `npm run validate:pnp-phase`.
- Added `reports/PNP_LOCAL_AUTHORITY_PHASE_RECEIPT_2026-07-22.md`.

## Key included root files

- package.json
- package-lock.json
- README.md
- .gitignore
- _headers
- _redirects
- index.html
- pricing.html
- sitemap.xml
- llms.txt
- REPO_VALIDATION_MATRIX.md

## Notes

No homepage layout, CSS, nav, copy, pricing, image assets, public offer scope, or UX structure was changed in this pass.

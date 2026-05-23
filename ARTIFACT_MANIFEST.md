# Artifact Manifest

- Artifact: p-n-p-main_BASELINE_05-23-26_e042178.zip
- Repo: p-n-p-main
- Packaged root: /mnt/data/pnp_img_work
- ZIP root layout: repo files are at archive root; no wrapper folder
- Mode: full baseline snapshot
- Date: 2026-05-23
- SHA-style suffix: e042178
- Source basis: latest p-n-p baseline with exact three user-selected porch images applied to homepage image asset filenames
- Validation run on this source tree: npm run validate:all
- Packaging validation: ZIP reopened and root files verified after packaging
- Updater target: generic v3 snapshot updater
- Status: STRUCTURALLY CHECKED + STATIC VALIDATION PASSED — LOCAL UPDATER NOT RUN

## Exact image replacements

- Memphis homepage card source filename: `/assets/img/porch/memphis-fall-front-porch-decorating-germantown.jpg`
  - Replaced with the fall porch image matching the user's selected bottom image.
- Collierville homepage card source filename: `/assets/img/porch/collierville-christmas-porch-decorating-front-door.jpg`
  - Replaced with the Christmas porch image matching the user's selected top image.
- Bartlett homepage card source filename: `/assets/img/porch/bartlett-small-front-porch-styling-under-500.jpg`
  - Replaced with the small porch image matching the user's selected middle image.

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

No homepage layout, CSS, nav, copy, pricing, or UX structure was changed in this pass. Only the three existing porch image asset files were replaced under the same filenames already referenced by the homepage.

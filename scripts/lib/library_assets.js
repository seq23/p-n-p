// Where the Design Library's AI fallback pictures live and where they are published, in one place:
// scripts/assemble_pages_output.js copies SOURCE -> <output>/OUTPUT, functions/_lib/admin-library.mjs
// reads /OUTPUT/<name> through env.ASSETS (behind the admin guard), and the validator harness
// serves the same mapping. NAME is the only file shape any of them accept.
module.exports = {
  SOURCE: 'data/admin/design-library/images',
  OUTPUT: 'admin/library/img',
  NAME: /^[A-Za-z0-9_-]{1,160}\.webp$/,
};

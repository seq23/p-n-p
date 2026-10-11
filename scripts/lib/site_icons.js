'use strict';
/**
 * The one definition of the favicon / touch-icon / manifest <link> block.
 *
 * templates/page-shell.js renders it into every generated page and
 * scripts/install_site_icons.js installs it into every hand-authored page, so the
 * two can never keep their own lists. favicon.ico returned 404 on the live site
 * until 2026-10-11; validate_site_icons.mjs guards the files and the tags.
 */
const MARKER = 'data-site-icons';
const HEAD_ICON_LINKS =
  `<link rel="icon" href="/favicon.ico" sizes="any" ${MARKER}>` +
  '<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/icons/favicon-32.png">' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' +
  '<link rel="manifest" href="/site.webmanifest">';
const ICON_FILES = [
  'favicon.ico',
  'apple-touch-icon.png',
  'site.webmanifest',
  'assets/img/icons/favicon-32.png',
  'assets/img/icons/icon-192.png',
  'assets/img/icons/icon-512.png',
];
module.exports = { MARKER, HEAD_ICON_LINKS, ICON_FILES };

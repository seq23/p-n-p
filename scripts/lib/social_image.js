'use strict';
/**
 * The real pixel size of an og:image, read from the file itself.
 *
 * WHY THIS READS THE FILE
 * -----------------------
 * og:image:width and og:image:height are a promise to Facebook, LinkedIn, Slack
 * and every AI preview that fetches a card: they size the frame from these two
 * numbers before the image arrives. A hand-written pair that does not match the
 * file is worse than none at all - the card renders at the wrong shape and the
 * picture is letterboxed or cropped. So the numbers are measured here, from the
 * bytes on disk, and scripts/validators/validate_social_tags.js re-measures them
 * and fails if any page disagrees with its own file.
 *
 * Minimum card size: Facebook and X both want at least 600x315 for a large
 * summary card and fall back to a small thumbnail below it. Every og:image on
 * this site is checked against that floor, so a social card can never silently
 * degrade because someone pointed og:image at a thumbnail.
 *
 * JPEG, PNG and WebP (VP8, VP8L and VP8X) headers are parsed directly; there is
 * no image dependency in this repository and this needs none.
 */
const fs = require('fs');

const MIN_WIDTH = 600;
const MIN_HEIGHT = 315;

function jpeg(buf) {
  let i = 2; // past SOI
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, skipping the four non-frame markers in that range
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function png(buf) {
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webp(buf) {
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (fourcc === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    return { width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
  }
  return null;
}

/** { width, height } for an image file, or throws naming the file. */
function measure(file) {
  const buf = fs.readFileSync(file);
  let d = null;
  if (buf[0] === 0xff && buf[1] === 0xd8) d = jpeg(buf);
  else if (buf.toString('ascii', 1, 4) === 'PNG') d = png(buf);
  else if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') d = webp(buf);
  if (!d || !d.width || !d.height) throw new Error(`${file}: could not read the image size; og:image:width/height cannot be written from a guess`);
  if (d.width < MIN_WIDTH || d.height < MIN_HEIGHT) {
    throw new Error(`${file} is ${d.width}x${d.height}; an og:image must be at least ${MIN_WIDTH}x${MIN_HEIGHT} or a share card falls back to a thumbnail`);
  }
  return d;
}

module.exports = { measure, MIN_WIDTH, MIN_HEIGHT };

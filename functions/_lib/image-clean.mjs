// Strips everything but the picture from an uploaded ID photo (owner rule: EXIF stripped).
// The phone already re-encodes the photo through a canvas (no EXIF survives that); this is
// the server-side layer for a photo sent without JavaScript. JPEG: drops APP1-APP15 (EXIF,
// XMP, ICC...) and COM segments, keeps APP0 (JFIF) and the image data. PNG: keeps only the
// chunks needed to draw the picture. Returns null when the bytes are not the claimed type.

export function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return '';
}

export function stripJpeg(bytes) {
  const out = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xd9) { out.push(bytes.subarray(i, i + 2)); i += 2; break; }
    if (marker === 0xda) { out.push(bytes.subarray(i)); i = bytes.length; break; } // start of scan: the rest is image data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(bytes.subarray(i, i + 2)); i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) out.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const size = out.reduce((n, b) => n + b.length, 0);
  const res = new Uint8Array(size);
  let at = 0;
  for (const b of out) { res.set(b, at); at += b.length; }
  return res;
}

const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'sRGB']);
export function stripPng(bytes) {
  const parts = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len;
    if (end > bytes.length) return null;
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const size = parts.reduce((n, b) => n + b.length, 0);
  const res = new Uint8Array(size);
  let at = 0;
  for (const b of parts) { res.set(b, at); at += b.length; }
  return res;
}

export function cleanImage(bytes, claimedType) {
  const type = sniff(bytes);
  if (!type || (claimedType && claimedType !== type && claimedType !== 'application/octet-stream')) return null;
  const clean = type === 'image/jpeg' ? stripJpeg(bytes) : stripPng(bytes);
  return clean ? { bytes: clean, type } : null;
}

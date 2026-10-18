// A plain "stored" (uncompressed) ZIP writer for "Download all receipts (zip)". Receipts are
// already compressed images/PDFs, so storing them is as small as deflating them.
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// files: [{ name, bytes: Uint8Array }] -> Uint8Array
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.bytes); const size = f.bytes.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.bytes);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// Reader used by the validator: [{ name, bytes }].
export function readZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); const out = []; let i = 0;
  while (i + 30 <= buf.length && v.getUint32(i, true) === 0x04034b50) {
    const size = v.getUint32(i + 18, true); const nlen = v.getUint16(i + 26, true); const xlen = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(buf.subarray(i + 30, i + 30 + nlen));
    const bytes = buf.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + size);
    out.push({ name, bytes, crcOk: crc32(bytes) === v.getUint32(i + 14, true) });
    i += 30 + nlen + xlen + size;
  }
  return out;
}

#!/usr/bin/env node
// The PDF text decoder the invoice validators share (lib/pdf_streams.mjs) must read
// every page, whatever bytes deflate happens to produce.
//
// Why: "Daily Authority Cycle" failed on 2026-10-27, 10-28 and 10-30 and passed on
// 10-26 and 10-29 with "Room setup line FAILED (6): PDF: ... note rows are missing".
// The invoice PDF was fine. Each validator found streams with
// /stream\r?\n([\s\S]*?)\r?\nendstream/, which drops a stream's last byte when it is
// 0x0D, so page 1 failed to inflate and was dropped. Whether that happened depended
// on the invoice's dates, i.e. on the day the check ran.
//
// 1. A pdf-lib-shaped stream whose deflated bytes end in 0x0D decodes to its text.
//    (The old regex reads nothing from it: proven here, so the case stays real.)
// 2. A FlateDecode stream that cannot inflate throws instead of being dropped.
// 3. No validator carries its own stream regex again (files scanned > 0).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pdfStreams, pdfTextItems } from './lib/pdf_streams.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const errors = [];
const must = (ok, msg) => { if (!ok) errors.push(msg); };

const legacy = (bytes) => {
  const out = [];
  for (const m of Buffer.from(bytes).toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { out.push(zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch { /* the old behaviour: drop the page */ }
  }
  return out;
};

// 1. A stream written exactly as pdf-lib writes one (dict, `stream\n`, /Length bytes,
//    `\nendstream`) whose deflated bytes end in 0x0D. About 1 text in 256 does.
let found = null;
for (let i = 0; i < 20000 && !found; i++) {
  const label = `Luxury Balloon Display ${crypto.createHash('sha1').update(String(i)).digest('hex').slice(0, 12)}`;
  const data = zlib.deflateSync(Buffer.from(`BT /F1 12 Tf 1 0 0 1 50 700 Tm <${Buffer.from(label, 'latin1').toString('hex')}> Tj ET`, 'latin1'));
  if (data[data.length - 1] !== 0x0d) continue;
  const bytes = Buffer.concat([
    Buffer.from(`%PDF-1.7\n4 0 obj\n<<\n/Filter /FlateDecode\n/Length ${data.length}\n>>\nstream\n`, 'latin1'), data,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]);
  found = { bytes, label };
}
must(found, 'Rule 0: no PDF with a 0x0D-terminated content stream was produced in 20000 tries; the case this guards is untested');
if (found) {
  const hex = Buffer.from(found.label, 'latin1').toString('hex').toUpperCase();
  must(pdfTextItems(found.bytes).includes(found.label), `the decoder lost the page whose stream ends in 0x0D ("${found.label}")`);
  must(!legacy(found.bytes).some((t) => t.toUpperCase().includes(hex)), 'the case is not real: the old regex reads this page too');
}

// 2. A corrupt FlateDecode stream throws.
const bad = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Length 4 /Filter /FlateDecode >>\nstream\nxxxx\nendstream\nendobj\n', 'latin1');
let threw = false; try { pdfStreams(bad); } catch { threw = true; }
must(threw, 'a FlateDecode stream that does not inflate was dropped instead of failing');

// 3. No validator decodes streams on its own.
const files = fs.readdirSync(HERE).filter((f) => /\.m?js$/.test(f) && f !== path.basename(fileURLToPath(import.meta.url)));
must(files.length > 0, 'Rule 0: scanned zero validator files');
for (const f of files) {
  if (/endstream\/|\\nendstream/.test(fs.readFileSync(path.join(HERE, f), 'utf8'))) must(false, `${f} decodes PDF streams with its own regex; use lib/pdf_streams.mjs`);
}

if (errors.length) { console.error(`PDF stream decoder FAILED (${errors.length}):\n${errors.map((e) => ` - ${e}`).join('\n')}`); process.exit(1); }
console.log(`PDF stream decoder OK: 0x0D-terminated page read ("${found.label}"), corrupt stream throws, ${files.length} validator file(s) scanned, none with their own stream regex`);

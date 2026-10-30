// Content streams of a PDF, inflated, read the way a PDF reader reads them.
//
// A stream's bytes are exactly /Length long. The validators used to find them with
// /stream\r?\n([\s\S]*?)\r?\nendstream/, which drops the stream's LAST byte whenever
// that byte is 0x0D: the optional `\r?` before `\nendstream` swallows it. Deflate
// output is effectively random, so roughly one invoice in 256 hit it, depending on the
// day's dates and wording, and the swallowed byte made inflate fail. The old loop then
// `continue`d past the whole page, so page 1 of the invoice vanished from the check and
// "Room setup line" went red on some days and green on others (2026-10-27/28/30).
//
// Read by /Length, and a FlateDecode stream that does not inflate THROWS: a page the
// decoder cannot read is a broken decoder, never a page to skip.
import zlib from 'node:zlib';

export function pdfStreams(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const out = [];
  const head = /<<((?:(?!>>\s*stream)[\s\S])*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = head.exec(raw))) {
    const dict = m[1];
    const len = /\/Length (\d+)(?! \d+ R)/.exec(dict);
    if (!len) throw new Error(`pdf_streams: a stream at byte ${m.index} has no direct /Length (${dict.trim().slice(0, 80)})`);
    const start = m.index + m[0].length;
    const data = Buffer.from(raw.slice(start, start + Number(len[1])), 'latin1');
    if (!/^\s*endstream/.test(raw.slice(start + Number(len[1]), start + Number(len[1]) + 16))) {
      throw new Error(`pdf_streams: the stream at byte ${m.index} is not followed by endstream after its /Length ${len[1]}`);
    }
    head.lastIndex = start + Number(len[1]);
    if (!/\/FlateDecode/.test(dict)) continue; // not a content stream we can read as text
    try {
      out.push(zlib.inflateSync(data).toString('latin1'));
    } catch (e) {
      throw new Error(`pdf_streams: the FlateDecode stream at byte ${m.index} (/Length ${len[1]}) does not inflate: ${e.message}`);
    }
  }
  return out;
}

// Every `<hex> Tj` text item, in stream order.
export function pdfTextItems(bytes) {
  const items = [];
  for (const t of pdfStreams(bytes)) for (const x of t.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) items.push(Buffer.from(x[1], 'hex').toString('latin1'));
  return items;
}

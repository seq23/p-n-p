#!/usr/bin/env node
'use strict';
// Exercise the real installer against legacy tags, conversion pages, inert
// markup and a page whose form was removed. Then check the published sitemap.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { formOrBuy, stripLoader } = require('../lib/clarity_scope');
const { publishedPages } = require('../install_contact_surface');
const ROOT = path.resolve(__dirname, '../..');
const legacy = '<script data-clarity-loader>legacy()</script>';
const page = (body) => `<html><head>${legacy}</head><body>${body}</body></html>`;
const fixtures = [
  ['info', '<a href="/request">Book online</a>', false],
  ['form', '<form action="/api/request"><input name="name"></form>', true],
  ['checkout', '<a href="https://buy.stripe.com/test">Pay</a>', true],
  ['cart', "<a href='/cart?item=1'>Cart</a>", true],
  ['unquoted', '<a href=/checkout>Checkout</a>', true],
  ['host-lookalike', '<a href="https://stripe.com.example.org">More</a>', false],
  ['inert', '<!-- <form> --><script>"<form>"</script><template><form></form></template>', false],
  ['privacy', '<p>Microsoft Clarity and privacy choices</p>', false],
];
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-clarity-scope-'));
try {
  for (const rel of ['scripts/install_clarity.js', 'scripts/lib/clarity_scope.js', 'data/clarity_projects.json']) {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(box, rel));
  }
  for (const [name, body, expected] of fixtures) {
    assert.equal(formOrBuy(body), expected, `${name}: conversion detection`);
    fs.writeFileSync(path.join(box, `${name}.html`), page(body));
  }
  const run = () => execFileSync(process.execPath, ['scripts/install_clarity.js'], { cwd: box, stdio: 'pipe' });
  run();
  const before = new Map();
  for (const [name, body, expected] of fixtures) {
    const html = fs.readFileSync(path.join(box, `${name}.html`), 'utf8');
    assert.equal((html.match(/<script data-clarity-loader>/g) || []).length, expected ? 1 : 0, `${name}: installed scope`);
    assert.equal(stripLoader(html), stripLoader(page(body)), `${name}: only the loader may change`);
    if (expected) assert.match(html, /clarity\.ms\/tag/);
    before.set(name, html);
  }
  run();
  for (const [name, html] of before) assert.equal(fs.readFileSync(path.join(box, `${name}.html`), 'utf8'), html, `${name}: idempotence`);
  const changed = path.join(box, 'form.html');
  fs.writeFileSync(changed, fs.readFileSync(changed, 'utf8').replace(/<form\b[\s\S]*?<\/form>/, '<p>Read more</p>'));
  run();
  assert.ok(!fs.readFileSync(changed, 'utf8').includes('data-clarity-loader'), 'removing the form removes Clarity');
} finally {
  fs.rmSync(box, { recursive: true, force: true });
}
const pages = publishedPages();
assert.ok(pages.length > 0, 'must examine published pages');
let recording = 0;
for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const count = (html.match(/<script\b[^>]*data-clarity-loader\b/gi) || []).length;
  assert.equal(count, formOrBuy(html) ? 1 : 0, `${rel}: Clarity must match form/checkout scope`);
  if (count) recording++;
}
assert.ok(recording > 0, 'must retain recording on the conversion step');
console.log(`clarity-scope: ${fixtures.length} installer fixtures, idempotence and form removal pass; ${pages.length} published pages checked, ${recording} form/checkout pages record`);

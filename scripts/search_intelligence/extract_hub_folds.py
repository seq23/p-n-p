#!/usr/bin/env python3
"""One-shot (26 Oct 2026): read the questions, answers, facts and prices off every page that
data/search_intelligence/hub_consolidation.json folds into a hub, and write them to
data/content/hub_folds.json, the data scripts/install_hub_folds.js renders each hub's
"More questions" section from.

It runs once, BEFORE the folded pages are deleted (afterwards there is nothing to read), and
its output is committed. It copies text only - never a link, picture or person - and keeps
one copy of any question or answer: a question already on the hub, or an answer already
taken from another folded page, is dropped, so the hub never carries the same FAQ twice.

Usage: python3 scripts/search_intelligence/extract_hub_folds.py
"""
import html as htmllib
import json
import os
import re
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SKIP = {'script', 'style', 'nav', 'header', 'footer', 'noscript', 'svg'}
BLOCKS = {'h1', 'h2', 'h3', 'h4', 'p', 'li'}


class Blocks(HTMLParser):
    """Flattens a page into (tag, text) blocks, ignoring chrome and the related-pages nav."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.cur, self.buf = [], 0, None, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in SKIP or a.get('data-nav') == 'related-pages' or 'data-contact' in a:
            self.skip += 1
            self._stack = getattr(self, '_stack', [])
            self._stack.append(tag)
            return
        if self.skip:
            if tag == getattr(self, '_stack', [None])[-1]:
                self.skip += 1
                self._stack.append(tag)
            return
        if tag in BLOCKS:
            self._flush()
            self.cur = tag

    def handle_endtag(self, tag):
        if self.skip:
            if self._stack and tag == self._stack[-1]:
                self._stack.pop()
                self.skip -= 1
            return
        if tag == self.cur:
            self._flush()

    def handle_data(self, data):
        if not self.skip and self.cur:
            self.buf.append(data)

    def _flush(self):
        if self.cur:
            text = re.sub(r'\s+', ' ', ''.join(self.buf)).strip()
            if text:
                self.out.append((self.cur, text))
        self.cur, self.buf = None, []


def blocks(rel):
    p = Blocks()
    p.feed(open(os.path.join(ROOT, rel), encoding='utf-8').read())
    p._flush()
    return p.out


def key(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


BOILERPLATE = re.compile(r'^(Use the Porch & Party quote form|Send the occasion, city|Share the occasion, city)')


def pairs(bl):
    """(question, answer) for every heading that asks something, answered by the next paragraph."""
    found = []
    for i, (tag, text) in enumerate(bl):
        if tag not in ('h1', 'h2', 'h3', 'h4'):
            continue
        nxt = next((t for g, t in bl[i + 1:i + 3] if g == 'p'), None)
        if tag == 'h1':
            # The page's own topic: its h1, answered by its recommendation (the first paragraph
            # under "What this page recommends"), falling back to the lead under the h1.
            rec = None
            for j, (g, t) in enumerate(bl):
                if g in ('h2', 'h3') and t.lower().startswith('what this page recommends'):
                    rec = next((u for h, u in bl[j + 1:j + 3] if h == 'p'), None)
                    break
            ans = rec or nxt
            if ans:
                found.append((text, ans))
        elif text.endswith('?') and nxt and found is not None:
            found.append((text, nxt))
    return [(q, a) for q, a in found if not BOILERPLATE.match(a)]


def main():
    plan = json.load(open(os.path.join(ROOT, 'data/search_intelligence/hub_consolidation.json')))
    folds = plan['folds']
    hubs = {}
    for f in folds:
        hubs.setdefault(f['to'], []).append(f)
    # A question that appears on three or more folded pages is the template's, not a page's
    # own (the service card's "What does X include?", "How far in advance should I book?"):
    # it is not a unique fact, and the hub already answers it in its own FAQ.
    freq = {}
    for f in folds:
        for q in {key(q) for q, _ in pairs(blocks(f['file']))[1:]}:
            freq[q] = freq.get(q, 0) + 1
    template = {q for q, n in freq.items() if n >= 3}
    out = {}
    for hub, members in sorted(hubs.items()):
        hub_rel = hub.lstrip('/') + '.html'
        hub_qs = {key(t) for g, t in blocks(hub_rel) if g in ('h1', 'h2', 'h3', 'h4')}
        seen_q, seen_a, items = set(hub_qs), set(), []
        for f in sorted(members, key=lambda m: m['file']):
            for q, a in pairs(blocks(f['file'])):
                if key(q) in seen_q or key(a) in seen_a or key(q) in template or q.startswith('Ready to'):
                    continue
                seen_q.add(key(q))
                seen_a.add(key(a))
                items.append({'q': q, 'a': a, 'from': f['from']})
        out[hub] = items
    doc = {
        'schema_version': 1,
        'written_by': 'scripts/search_intelligence/extract_hub_folds.py (one-shot, 26 Oct 2026)',
        'rendered_by': 'scripts/install_hub_folds.js',
        'rule': 'Text only, one copy of each question and answer per hub; a question the hub already asks is dropped.',
        'hubs': out,
    }
    path = os.path.join(ROOT, 'data/content/hub_folds.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'hub_folds: {sum(len(v) for v in out.values())} items across {len(out)} hubs')


if __name__ == '__main__':
    main()

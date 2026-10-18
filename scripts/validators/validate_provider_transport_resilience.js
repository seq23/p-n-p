#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Provider transport resilience (Search Console client calls).
 *
 * Run 35239441050 (2026-09-17) turned the distribution lane red on a single
 * `TimeoutError: The read operation timed out` inside gsc_inspect_urls.py -
 * after IndexNow and the sitemap had been submitted, on the same 61 URLs that
 * completed on each of the previous days. Every googleapiclient call in
 * distribution_scripts/ used execute() with its default of zero retries, and
 * the inspection results were written only after the loop, so one dropped read
 * discarded every inspection already completed.
 *
 * Two proofs:
 *
 *  1. STATIC. Every `.execute(` in distribution_scripts/*.py passes
 *     `num_retries=`. googleapiclient's _retry_request retries socket timeouts,
 *     connection resets, SSL errors, 429 and 5xx only when asked. Hard-fails on
 *     zero execute() calls found.
 *
 *  2. BEHAVIOURAL. gsc_inspect_urls.py is run against a stub googleapiclient
 *     (written to a temp dir and put first on PYTHONPATH) that honours
 *     num_retries the way the real one does, through four scenarios:
 *       timeout once, then serve      -> exit 0, every URL in the results file
 *       timeout on every attempt      -> exit 1, results file written, the
 *                                        failed URL recorded with its error
 *       HTTP 429                      -> exit 2, inspection-hold.json says
 *                                        HELD_QUOTA
 *       HTTP 401                      -> exit 2, HELD_CREDENTIAL
 *       HTTP 500 on 1 of 3 URLs       -> exit 3 DEFERRED, named line, carried;
 *                                        the same URL 3 runs in a row -> exit 1
 *       5xx on all / half or more     -> exit 1; 404 -> exit 1; 403 -> HELD
 *     and deploy_distribution.sh's mapping of those exit codes into the receipt
 *     is checked by reading the script: 0 -> COMPLETED, 2 -> HELD_*, else
 *     FAILED, and only FAILED exits non-zero.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'distribution_scripts');
const errors = [];

// ------------------------------------------------------------------ 1. static
const pyFiles = fs.readdirSync(DIST).filter((f) => f.endsWith('.py')).sort();
let executeCalls = 0;
for (const f of pyFiles) {
  const text = fs.readFileSync(path.join(DIST, f), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!/\.execute\(/.test(line)) return;
    executeCalls += 1;
    if (!/\.execute\([^)]*num_retries\s*=/.test(line)) {
      errors.push(`${f}:${i + 1}: \`.execute(\` without num_retries=. One socket timeout fails the lane; this is the exact call shape of run 35239441050.`);
    }
  });
}
if (!executeCalls) {
  console.error('validate:provider-transport-resilience FAILED: found zero .execute( calls under distribution_scripts/. The scan is broken, not the repo.');
  process.exit(1);
}

// -------------------------------------------------------------- 2. behaviour
const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
if (py.status !== 0) {
  console.error('validate:provider-transport-resilience FAILED: python3 is not runnable, so the behavioural proof cannot run. The scan is broken, not the repo.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-stub-'));
const stubDir = path.join(tmp, 'site-packages');
fs.mkdirSync(path.join(stubDir, 'google', 'oauth2'), { recursive: true });
fs.mkdirSync(path.join(stubDir, 'googleapiclient'), { recursive: true });
fs.writeFileSync(path.join(stubDir, 'google', '__init__.py'), '');
fs.writeFileSync(path.join(stubDir, 'google', 'oauth2', '__init__.py'), '');
fs.writeFileSync(path.join(stubDir, 'google', 'oauth2', 'service_account.py'), `
class Credentials:
    @staticmethod
    def from_service_account_file(path, scopes=None):
        return Credentials()
`);
fs.writeFileSync(path.join(stubDir, 'googleapiclient', '__init__.py'), '');
fs.writeFileSync(path.join(stubDir, 'googleapiclient', 'errors.py'), `
class _Resp:
    def __init__(self, status): self.status = status
class HttpError(Exception):
    def __init__(self, status, content=b''):
        super().__init__(f"<HttpError {status}>")
        self.resp = _Resp(status); self.content = content
`);
// SCENARIO env: "timeout_once" | "timeout_always" | "http_429" | "http_401".
// Mirrors googleapiclient: the request is attempted num_retries + 1 times and
// a socket timeout is re-raised only when the attempts are exhausted.
fs.writeFileSync(path.join(stubDir, 'googleapiclient', 'discovery.py'), `
import os, socket
from googleapiclient.errors import HttpError
SCENARIO = os.environ["SCENARIO"]
class _Req:
    def __init__(self, url): self.url = url; self.attempts = 0
    def execute(self, num_retries=0):
        for attempt in range(num_retries + 1):
            self.attempts += 1
            if SCENARIO == "timeout_once" and attempt == 0:
                continue  # first attempt "timed out"; a retry serves
            if SCENARIO == "timeout_always":
                continue
            if SCENARIO == "http_429":
                raise HttpError(429, b'{"error":{"message":"Quota exceeded for quota metric"}}')
            if SCENARIO == "http_status" and self.url in os.environ.get("FAIL_URLS", "").split(","):
                raise HttpError(int(os.environ["FAIL_STATUS"]), b'{"error":{"message":"Internal error encountered."}}')
            if SCENARIO == "http_401":
                raise HttpError(401, b'{"error":{"message":"Request had invalid authentication credentials"}}')
            return {"inspectionUrl": self.url, "inspectionResult": {"indexStatusResult": {"verdict": "PASS"}}, "attempts": self.attempts}
        raise socket.timeout("The read operation timed out")
class _Index:
    def inspect(self, body): return _Req(body["inspectionUrl"])
class _UrlInspection:
    def index(self): return _Index()
class _Service:
    def urlInspection(self): return _UrlInspection()
def build(name, version, credentials=None): return _Service()
`);
const creds = path.join(tmp, 'sa.json'); fs.writeFileSync(creds, '{}');
const urlFile = path.join(tmp, 'urls.txt');
fs.writeFileSync(urlFile, 'https://example.test/a\nhttps://example.test/b\n# comment\n');

const urlFile3 = path.join(tmp, 'urls3.txt');
fs.writeFileSync(urlFile3, 'https://example.test/a\nhttps://example.test/b\nhttps://example.test/c\n');

// opts: { dir, urls, failUrls, failStatus, state } - state is a carry-over file
// path shared across calls so runs can be chained the way the workflow chains them.
function scenario(name, opts = {}) {
  const out = path.join(tmp, opts.dir || name, 'inspection-results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const env = { ...process.env, PYTHONPATH: stubDir, SCENARIO: opts.failStatus ? 'http_status' : name, PYTHONDONTWRITEBYTECODE: '1' };
  if (opts.failStatus) { env.FAIL_STATUS = String(opts.failStatus); env.FAIL_URLS = (opts.failUrls || []).join(','); }
  if (opts.state) env.GSC_DEFERRED_STATE = opts.state; else delete env.GSC_DEFERRED_STATE;
  const r = spawnSync('python3', [path.join(DIST, 'gsc_inspect_urls.py'), creds, 'sc-domain:example.test', opts.urls || urlFile, out], { encoding: 'utf8', env });
  const results = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const holdPath = path.join(path.dirname(out), 'inspection-hold.json');
  const hold = fs.existsSync(holdPath) ? JSON.parse(fs.readFileSync(holdPath, 'utf8')) : null;
  const defPath = path.join(path.dirname(out), 'inspection-deferred.json');
  const deferred = fs.existsSync(defPath) ? JSON.parse(fs.readFileSync(defPath, 'utf8')) : null;
  const state = opts.state && fs.existsSync(opts.state) ? JSON.parse(fs.readFileSync(opts.state, 'utf8')).deferred : null;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, results, hold, deferred, state };
}

const expect = (cond, msg) => { if (!cond) errors.push(msg); };

let s = scenario('timeout_once');
expect(s.code === 0, `timeout_once: expected exit 0 (a retry served), got ${s.code}. ${s.stderr.trim().split('\n').pop() || ''}`);
expect(s.results && s.results.length === 2 && s.results.every((x) => x.attempts === 2), 'timeout_once: expected both URLs served on the second attempt and recorded in the results file.');
expect(!s.hold, 'timeout_once: no hold file expected.');

s = scenario('timeout_always');
expect(s.code === 1, `timeout_always: expected exit 1 (FAILED after every retry), got ${s.code}.`);
expect(s.results && s.results.length === 2 && s.results.every((x) => /timed out/.test(x.error || '')), 'timeout_always: the results file must still be written, with each URL recorded with its transport error.');
expect(!s.hold, 'timeout_always: a transport fault is a failure, not a hold.');

s = scenario('http_429');
expect(s.code === 2, `http_429: expected exit 2 (HELD), got ${s.code}.`);
expect(s.hold && s.hold.status === 'HELD_QUOTA', `http_429: expected inspection-hold.json status HELD_QUOTA, got ${s.hold && s.hold.status}.`);
expect(/::warning/.test(s.stdout), 'http_429: the hold must be annotated on the run (::warning).');

s = scenario('http_401');
expect(s.code === 2, `http_401: expected exit 2 (HELD), got ${s.code}.`);
expect(s.hold && s.hold.status === 'HELD_CREDENTIAL', `http_401: expected HELD_CREDENTIAL, got ${s.hold && s.hold.status}.`);

// ---- provider 5xx on a minority -> DEFERRED, carried, hard-fail at 3 in a row.
// Main 36322b6 (2026-10-18): HTTP 500 on ONE of 61 URLs after 5 retries turned
// main red; a rerun went green.
const A = 'https://example.test/a';
const stateFile = path.join(tmp, 'carry', 'deferred.json');
s = scenario('defer1', { urls: urlFile3, failStatus: 500, failUrls: [A], state: stateFile });
expect(s.code === 3, `5xx on 1 of 3 URLs: expected exit 3 (DEFERRED, lane green), got ${s.code}. ${s.stdout.trim().split('\n').pop() || ''}`);
expect(/GSC inspection deferred for 1 URL\(s\): provider 5xx/.test(s.stdout), '5xx minority: the NAMED line "GSC inspection deferred for 1 URL(s): provider 5xx" must be printed.');
expect(/::warning title=GSC URL inspection DEFERRED/.test(s.stdout), '5xx minority: the deferral must be annotated on the run (::warning).');
expect(s.state && s.state[A] === 1 && Object.keys(s.state).length === 1, `5xx minority: carry-over state must record ${A} deferred 1 run, got ${JSON.stringify(s.state)}.`);
expect(s.deferred && s.deferred.status === 'DEFERRED' && s.deferred.fatal === null, '5xx minority: inspection-deferred.json must say DEFERRED with no fatal reason.');
expect(s.results && s.results.length === 3 && s.results.filter((x) => x.deferred).length === 1, '5xx minority: the other URLs must still be inspected and the deferred one recorded.');

s = scenario('defer2', { urls: urlFile3, failStatus: 500, failUrls: [A], state: stateFile });
expect(s.code === 3 && s.state && s.state[A] === 2, `5xx carried, second run in a row: expected exit 3 and count 2, got ${s.code} / ${JSON.stringify(s.state)}.`);
expect(/Carried over 1 URL/.test(s.stdout) && s.stdout.indexOf(`Inspecting: ${A}`) < s.stdout.indexOf('Inspecting: https://example.test/b'), '5xx carried: the deferred URL must be inspected first on the next run.');

s = scenario('defer3', { urls: urlFile3, failStatus: 500, failUrls: [A], state: stateFile });
expect(s.code === 1, `same URL deferred 3 runs in a row: expected exit 1 (FAILED), got ${s.code}.`);
expect(s.deferred && /3 runs in a row/.test(s.deferred.fatal || ''), 'deferred 3 in a row: inspection-deferred.json must name the fatal reason.');

s = scenario('defer_served', { urls: urlFile3, failStatus: 500, failUrls: [], state: stateFile });
expect(s.code === 0 && s.state && Object.keys(s.state).length === 0, `a deferred URL that is served clears its count: expected exit 0 and empty state, got ${s.code} / ${JSON.stringify(s.state)}.`);
expect(!s.deferred, 'served run: no inspection-deferred.json may be left behind.');

const orphanState = path.join(tmp, 'orphan', 'deferred.json');
fs.mkdirSync(path.dirname(orphanState), { recursive: true });
fs.writeFileSync(orphanState, JSON.stringify({ deferred: { 'https://example.test/gone': 1 } }));
s = scenario('defer_orphan', { urls: urlFile3, failStatus: 500, failUrls: [], state: orphanState });
expect(s.code === 0 && /Inspecting: https:\/\/example\.test\/gone/.test(s.stdout), 'a deferred URL that left the priority list must still be inspected next run.');

s = scenario('defer_all', { urls: urlFile3, failStatus: 500, failUrls: [A, 'https://example.test/b', 'https://example.test/c'], state: path.join(tmp, 'all', 'd.json') });
expect(s.code === 1, `5xx on every URL: expected exit 1 (FAILED), got ${s.code}.`);
s = scenario('defer_majority', { urls: urlFile3, failStatus: 503, failUrls: [A, 'https://example.test/b'], state: path.join(tmp, 'maj', 'd.json') });
expect(s.code === 1, `5xx on 2 of 3 URLs (not a minority): expected exit 1 (FAILED), got ${s.code}.`);
s = scenario('http_404', { urls: urlFile3, failStatus: 404, failUrls: [A], state: path.join(tmp, '404', 'd.json') });
expect(s.code === 1 && !s.deferred, `a 4xx that is not quota/credential: expected exit 1 (FAILED) and nothing deferred, got ${s.code}.`);
s = scenario('http_403', { urls: urlFile3, failStatus: 403, failUrls: [A], state: path.join(tmp, '403', 'd.json') });
expect(s.code === 2 && s.hold && s.hold.status === 'HELD_CREDENTIAL' && !s.deferred, `a 403 permission refusal is never deferred: expected HELD_CREDENTIAL, got ${s.code} / ${s.hold && s.hold.status}.`);

// The wrapper's mapping. Read, not run: the wrapper also submits IndexNow.
const sh = fs.readFileSync(path.join(DIST, 'deploy_distribution.sh'), 'utf8');
expect(/0\)\s*gsc_inspection_status="COMPLETED"/.test(sh), 'deploy_distribution.sh: exit 0 from gsc_inspect_urls.py must map to COMPLETED.');
expect(/2\)\s*gsc_inspection_status=/.test(sh) && /HELD_QUOTA/.test(sh) && /HELD_CREDENTIAL/.test(sh), 'deploy_distribution.sh: exit 2 must map to the named hold (HELD_QUOTA / HELD_CREDENTIAL) read from inspection-hold.json.');
expect(/3\)\s*gsc_inspection_status="DEFERRED"/.test(sh), 'deploy_distribution.sh: exit 3 must map to DEFERRED (green, named).');
expect(/gsc_inspection_deferred/.test(sh), 'deploy_distribution.sh: the receipt must carry the deferral (gsc_inspection_deferred).');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-distribution.yml'), 'utf8');
expect(/actions\/cache\/restore@/.test(wf) && /actions\/cache\/save@/.test(wf) && /GSC_DEFERRED_STATE:/.test(wf), 'deploy-distribution.yml: the carry-over state must be restored and saved between runs (actions/cache) and handed to the script (GSC_DEFERRED_STATE); without it "3 runs in a row" can never be reached.');
expect(/\*\)\s*gsc_inspection_status="FAILED"/.test(sh), 'deploy_distribution.sh: any other exit must map to FAILED.');
expect(/gsc_inspection_status" == "FAILED" \]\]; then exit 1/.test(sh), 'deploy_distribution.sh: only FAILED (never HELD_*) may exit the wrapper non-zero.');

fs.rmSync(tmp, { recursive: true, force: true });

if (errors.length) {
  console.error(`validate:provider-transport-resilience FAILED: ${errors.length} defect(s).`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Provider transport resilience OK (${executeCalls} execute() call(s) across ${pyFiles.length} script(s), all with num_retries; 13 stubbed provider scenarios: retry serves, persistent timeout fails with evidence kept, 429 holds as HELD_QUOTA, 401/403 hold as HELD_CREDENTIAL, 5xx minority defers and carries, 3-in-a-row / all / majority 5xx and 404 fail; wrapper maps 0/2/3/other to COMPLETED/HELD_*/DEFERRED/FAILED)`);

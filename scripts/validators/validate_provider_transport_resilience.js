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

function scenario(name) {
  const out = path.join(tmp, name, 'inspection-results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('python3', [path.join(DIST, 'gsc_inspect_urls.py'), creds, 'sc-domain:example.test', urlFile, out], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stubDir, SCENARIO: name, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const results = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const holdPath = path.join(path.dirname(out), 'inspection-hold.json');
  const hold = fs.existsSync(holdPath) ? JSON.parse(fs.readFileSync(holdPath, 'utf8')) : null;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, results, hold };
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

// The wrapper's mapping. Read, not run: the wrapper also submits IndexNow.
const sh = fs.readFileSync(path.join(DIST, 'deploy_distribution.sh'), 'utf8');
expect(/0\)\s*gsc_inspection_status="COMPLETED"/.test(sh), 'deploy_distribution.sh: exit 0 from gsc_inspect_urls.py must map to COMPLETED.');
expect(/2\)\s*gsc_inspection_status=/.test(sh) && /HELD_QUOTA/.test(sh) && /HELD_CREDENTIAL/.test(sh), 'deploy_distribution.sh: exit 2 must map to the named hold (HELD_QUOTA / HELD_CREDENTIAL) read from inspection-hold.json.');
expect(/\*\)\s*gsc_inspection_status="FAILED"/.test(sh), 'deploy_distribution.sh: any other exit must map to FAILED.');
expect(/gsc_inspection_status" == "FAILED" \]\]; then exit 1/.test(sh), 'deploy_distribution.sh: only FAILED (never HELD_*) may exit the wrapper non-zero.');

fs.rmSync(tmp, { recursive: true, force: true });

if (errors.length) {
  console.error(`validate:provider-transport-resilience FAILED: ${errors.length} defect(s).`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Provider transport resilience OK (${executeCalls} execute() call(s) across ${pyFiles.length} script(s), all with num_retries; 4 stubbed provider scenarios: retry serves, persistent timeout fails with evidence kept, 429 holds as HELD_QUOTA, 401 holds as HELD_CREDENTIAL; wrapper maps 0/2/other to COMPLETED/HELD_*/FAILED)`);

#!/usr/bin/env python3
"""Inspect every priority URL through the Search Console URL Inspection API.

Transport faults are retried; result faults are not hidden; a provider that
refuses to serve is a NAMED STOP rather than a red run.

Run 35239441050 (2026-09-17) failed the distribution lane on `TimeoutError:
The read operation timed out` from one inspect() call, on the same 61 URLs that
had completed every day before. `execute()` was called with its default of zero
retries, and the results file was written only after the loop, so a single
dropped read discarded every inspection that had already completed and turned
the whole distribution receipt red - after IndexNow and the sitemap had already
been submitted successfully.

Exit codes, which deploy_distribution.sh maps into the receipt:
  0  COMPLETED  every URL inspected.
  2  HELD       the provider refused: quota exhausted (429, or 403 naming a
                quota/rate limit) or the credential is not accepted (401, other
                403). Nothing more can be inspected this run and retrying would
                not change that, so the hold is named in inspection-hold.json
                and on the run, the URLs inspected so far are kept, and the lane
                is left green: IndexNow and the sitemap were submitted, which is
                the distribution. A held inspection is a report gap, not a
                distribution failure. It is still visible: a `::warning::`
                annotation on the run and HELD_* in the receipt.
  3  DEFERRED   the provider answered 5xx on a MINORITY of URLs after every
                retry. Run 36322b6 on main (2026-10-18) went red because Search
                Console returned HTTP 500 for ONE of 61 URLs after 5 retries; a
                rerun went green. A provider-side 5xx is the provider's fault,
                not the site's, so those URLs are recorded `deferred` in the
                carry-over state file, inspected FIRST next run, and the run
                prints the named line "GSC inspection deferred for N URL(s):
                provider 5xx" (also a ::warning and DEFERRED in the receipt).
                The lane stays green.
  1  FAILED     a transport fault that survived every retry, an inspection
                that errored for any other reason (a 4xx that is not a quota or
                credential refusal), an empty URL list, OR a deferral that is
                not a minority: every URL deferred, half or more deferred, or
                the same URL deferred 3 runs in a row (DEFER_LIMIT). This is
                the state a human should look at.

Carry-over state: GSC_DEFERRED_STATE (default: inspection-deferred-state.json
next to the results file) holds {"deferred": {url: consecutive_runs}}. The
workflow restores and saves it through actions/cache so it survives between
runs. A URL that is served clears its count; a URL deferred again increments it.

Every execute() is retried with exponential backoff: googleapiclient's
_retry_request covers socket timeouts, connection resets, SSL errors, 429 and
5xx. A URL that still fails after the retries is recorded in the results file
with its error, the loop continues, the file is always written, and the process
exits 1 if any URL failed - so the receipt says FAILED, but it says which URL
and why, and the completed inspections survive as evidence.
"""
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# 5 retries after the first attempt, each backing off up to 2**n seconds
# (googleapiclient sleeps rand() * 2**retry_num), before giving up on one URL.
NUM_RETRIES = 5

EXIT_COMPLETED = 0
EXIT_FAILED = 1
EXIT_HELD = 2
EXIT_DEFERRED = 3

# The same URL deferred this many runs in a row is no longer a provider blip.
DEFER_LIMIT = 3


def is_provider_5xx(exc):
    return isinstance(exc, HttpError) and isinstance(getattr(exc.resp, "status", None), int) and 500 <= exc.resp.status <= 599


def load_state(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        deferred = data.get("deferred", {})
        return {str(k): int(v) for k, v in deferred.items()} if isinstance(deferred, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:  # noqa: BLE001 - an unreadable state file is named, then treated as empty
        print(f"gsc_inspect_urls: carry-over state {path} unreadable ({exc}); starting with no deferred URLs.")
        return {}


def save_state(path, deferred):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps({"schema_version": "1.0", "deferred": deferred}, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_urls(path):
    urls = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("http://") or line.startswith("https://"):
                urls.append(line)
    return urls


def classify_hold(exc):
    """Return (HELD_QUOTA | HELD_CREDENTIAL, detail) when the provider refused
    in a way no retry can fix, else None."""
    if not isinstance(exc, HttpError):
        return None
    status = getattr(exc.resp, "status", None)
    text = ""
    try:
        text = exc.content.decode("utf-8", "replace") if isinstance(exc.content, bytes) else str(exc.content)
    except Exception:  # noqa: BLE001
        text = str(exc)
    lowered = text.lower()
    if status == 429 or (status == 403 and ("quota" in lowered or "ratelimit" in lowered or "rate limit" in lowered)):
        return "HELD_QUOTA", f"HTTP {status}: {text[:300]}"
    if status in (401, 403):
        return "HELD_CREDENTIAL", f"HTTP {status}: {text[:300]}"
    return None


def write_results(output_json, results):
    Path(output_json).parent.mkdir(parents=True, exist_ok=True)
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)


def main():
    if len(sys.argv) != 5:
        print("Usage: gsc_inspect_urls.py <service-account.json> <siteUrl> <urlFile> <outputJson>")
        sys.exit(EXIT_FAILED)

    creds_path = sys.argv[1]
    site_url = sys.argv[2]
    url_file = sys.argv[3]
    output_json = sys.argv[4]
    hold_json = str(Path(output_json).with_name("inspection-hold.json"))
    deferred_json = str(Path(output_json).with_name("inspection-deferred.json"))
    state_path = os.environ.get("GSC_DEFERRED_STATE") or str(Path(output_json).with_name("inspection-deferred-state.json"))

    scopes = ["https://www.googleapis.com/auth/webmasters.readonly"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
    service = build("searchconsole", "v1", credentials=creds)

    urls = load_urls(url_file)
    if not urls:
        print(f"gsc_inspect_urls: {url_file} contains no URLs. Nothing was inspected, so this is a failure, not an empty success.")
        sys.exit(EXIT_FAILED)

    # URLs deferred last run go first, even if they have left the priority list.
    prior = load_state(state_path)
    carried = [u for u in prior if u not in urls] + [u for u in urls if u in prior]
    urls = carried + [u for u in urls if u not in prior]
    if prior:
        print(f"Carried over {len(prior)} URL(s) deferred last run; inspecting them first.")

    results = []
    failures = []
    deferred = []
    attempted = set()
    hold = None

    for url in urls:
        print(f"Inspecting: {url}")
        body = {
            "inspectionUrl": url,
            "siteUrl": site_url,
            "languageCode": "en-US"
        }
        attempted.add(url)
        try:
            resp = service.urlInspection().index().inspect(body=body).execute(num_retries=NUM_RETRIES)
            results.append(resp)
        except Exception as exc:  # noqa: BLE001 - every failure is recorded, none is swallowed
            err = f"{type(exc).__name__}: {exc}"
            held = classify_hold(exc)
            if held:
                status, detail = held
                hold = {
                    "status": status,
                    "detail": detail,
                    "first_url_refused": url,
                    "inspected": len(results),
                    "not_inspected": len(urls) - len(results),
                    "why_not_red": "IndexNow and the sitemap submission are the distribution and were attempted independently. "
                                   "URL inspection is a report on the result; a provider that refuses it cannot be retried into serving it.",
                    "what_unblocks_it": "HELD_QUOTA clears when the Search Console URL Inspection quota resets (daily). "
                                        "HELD_CREDENTIAL needs the GSC_SERVICE_ACCOUNT_JSON secret re-issued or the service account "
                                        "re-added to the Search Console property - an owner action, not a code change.",
                }
                print(f"HELD ({status}) at {url}: {detail}")
                break
            if is_provider_5xx(exc):
                print(f"DEFERRED after {NUM_RETRIES} retries (provider {exc.resp.status}): {url} -> {err}")
                deferred.append(url)
                results.append({"inspectionUrl": url, "error": err, "deferred": True, "deferred_runs": prior.get(url, 0) + 1})
                continue
            print(f"FAILED after {NUM_RETRIES} retries: {url} -> {err}")
            failures.append(url)
            results.append({"inspectionUrl": url, "error": err})

    write_results(output_json, results)

    # Carry-over: deferred now -> count + 1; never attempted (a hold stopped the
    # loop) -> count kept; served or failed outright -> cleared.
    new_state = {u: prior.get(u, 0) + 1 for u in deferred}
    for u, n in prior.items():
        if u not in attempted:
            new_state[u] = n
    save_state(state_path, new_state)

    over_limit = sorted(u for u, n in new_state.items() if n >= DEFER_LIMIT)
    deferral_fatal = None
    if deferred:
        if len(deferred) == len(urls):
            deferral_fatal = f"every URL ({len(urls)}) answered provider 5xx - the provider is down for this property, not blipping"
        elif len(deferred) * 2 >= len(urls):
            deferral_fatal = f"{len(deferred)} of {len(urls)} URLs answered provider 5xx - not a minority"
    if over_limit:
        deferral_fatal = (deferral_fatal + "; " if deferral_fatal else "") + \
            f"deferred {DEFER_LIMIT} runs in a row: " + ", ".join(over_limit)
    if deferred:
        named = f"GSC inspection deferred for {len(deferred)} URL(s): provider 5xx"
        print(named)
        Path(deferred_json).write_text(json.dumps({
            "status": "DEFERRED",
            "named_line": named,
            "deferred_urls": {u: new_state[u] for u in deferred},
            "defer_limit": DEFER_LIMIT,
            "carried_to": state_path,
            "fatal": deferral_fatal,
        }, indent=2) + "\n", encoding="utf-8")
        if not deferral_fatal:
            print(f"::warning title=GSC URL inspection DEFERRED::{named} - carried into the next run ({', '.join(deferred)})")
    elif Path(deferred_json).exists():
        Path(deferred_json).unlink()

    if hold:
        Path(hold_json).write_text(json.dumps(hold, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {len(results)} inspection results to {output_json}; {hold['not_inspected']} URL(s) not inspected.")
        print(f"::warning title=GSC URL inspection {hold['status']}::{hold['detail']} - {hold['what_unblocks_it']}")
        sys.exit(EXIT_HELD)

    if Path(hold_json).exists():
        Path(hold_json).unlink()
    print(f"Wrote {len(results)} inspection results to {output_json} ({len(failures)} failed, {len(deferred)} deferred)")
    if failures:
        print("Inspection failed for: " + ", ".join(failures))
        sys.exit(EXIT_FAILED)
    if deferral_fatal:
        print(f"Inspection deferral is a failure: {deferral_fatal}")
        sys.exit(EXIT_FAILED)
    if deferred:
        sys.exit(EXIT_DEFERRED)
    sys.exit(EXIT_COMPLETED)


if __name__ == "__main__":
    main()

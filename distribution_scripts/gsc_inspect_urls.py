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
  1  FAILED     a transport fault that survived every retry, an inspection
                that errored for any other reason, or an empty URL list.
                This is the state a human should look at.

Every execute() is retried with exponential backoff: googleapiclient's
_retry_request covers socket timeouts, connection resets, SSL errors, 429 and
5xx. A URL that still fails after the retries is recorded in the results file
with its error, the loop continues, the file is always written, and the process
exits 1 if any URL failed - so the receipt says FAILED, but it says which URL
and why, and the completed inspections survive as evidence.
"""
import json
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

    scopes = ["https://www.googleapis.com/auth/webmasters.readonly"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
    service = build("searchconsole", "v1", credentials=creds)

    urls = load_urls(url_file)
    if not urls:
        print(f"gsc_inspect_urls: {url_file} contains no URLs. Nothing was inspected, so this is a failure, not an empty success.")
        sys.exit(EXIT_FAILED)

    results = []
    failures = []
    hold = None

    for url in urls:
        print(f"Inspecting: {url}")
        body = {
            "inspectionUrl": url,
            "siteUrl": site_url,
            "languageCode": "en-US"
        }
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
            print(f"FAILED after {NUM_RETRIES} retries: {url} -> {err}")
            failures.append(url)
            results.append({"inspectionUrl": url, "error": err})

    write_results(output_json, results)

    if hold:
        Path(hold_json).write_text(json.dumps(hold, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {len(results)} inspection results to {output_json}; {hold['not_inspected']} URL(s) not inspected.")
        print(f"::warning title=GSC URL inspection {hold['status']}::{hold['detail']} - {hold['what_unblocks_it']}")
        sys.exit(EXIT_HELD)

    if Path(hold_json).exists():
        Path(hold_json).unlink()
    print(f"Wrote {len(results)} inspection results to {output_json} ({len(failures)} failed)")
    if failures:
        print("Inspection failed for: " + ", ".join(failures))
        sys.exit(EXIT_FAILED)
    sys.exit(EXIT_COMPLETED)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Measure index coverage for every sitemap URL through the URL Inspection API.

Why (2026-10-10): Search Console showed 66 impressions over 28 days, all on the
homepage, while Bing had 50+ pages indexed and the inner pages carried clean
canonicals. Whether Google has crawled, indexed, or merely discovered the other
114 pages was never measured: distribution_scripts/gsc_inspect_urls.py inspects
a priority list in the deploy lane and its results die with the run artifact.
This step runs in the daily cycle and commits
data/search_intelligence/index_coverage.json, so a week of it is the input to the
consolidation decision (data/search_intelligence/consolidation_candidates.json).

Quota: URL Inspection allows 2,000 calls per day per property. The deploy lane
spends some of that, so this step caps itself at PER_RUN_CAP and, if the sitemap
ever exceeds the cap, inspects the URLs with the oldest result first and carries
the rest forward with their own inspected_at.

Outcomes, one line each, never a silent zero:
  - credentials absent: NAMED STOP, exit 0. An existing file is left untouched
    (a secretless run never blanks evidence); with no file, one is written that
    lists every sitemap URL as NOT_INSPECTED so the gap is visible and counted.
  - Search Console refuses (401/403, HELD_CREDENTIAL): NAMED STOP naming the exact
    owner step (add the service account as a user on the property), exit 0.
  - quota exhausted (HELD_QUOTA): NAMED STOP, exit 0; inspected URLs are kept.
  - otherwise the file is written; exit 1 only when nothing could be inspected.
"""
import json
import os
import re
import sys
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_gsc_export import service_account_info  # noqa: E402  same credential rules as the export

OUT = ROOT / "data/search_intelligence/index_coverage.json"
SITEMAP = ROOT / "sitemap.xml"
# One inspect() call takes ~6 s (deploy lane, run 38108750287: 61 URLs in 6.5 min),
# so the first serial run of 116 URLs was cancelled at 10 min. Calls run in
# parallel, well inside the API's 600-per-minute limit.
WORKERS = 8
DEFAULT_PROPERTY = "sc-domain:porchandparty901.com"
DAILY_QUOTA = 2000
PER_RUN_CAP = 1500  # leaves 500/day for the deploy lane's priority inspections

BUCKETS = (
    ("indexed", re.compile(r"^(submitted and indexed|indexed, not submitted in sitemap|indexed)", re.I)),
    ("crawled_not_indexed", re.compile(r"crawled - currently not indexed", re.I)),
    ("discovered_not_indexed", re.compile(r"discovered - currently not indexed", re.I)),
)


def bucket(state):
    for name, rx in BUCKETS:
        if rx.search(state or ""):
            return name
    return "other"


def sitemap_urls():
    return re.findall(r"<loc>([^<]+)</loc>", SITEMAP.read_text(encoding="utf-8"))


def now():
    return datetime.now(timezone.utc).isoformat()


def load_previous():
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def row_from(resp, inspected_at):
    r = (resp.get("inspectionResult") or {}).get("indexStatusResult") or {}
    return {
        "url": resp.get("inspectionUrl"),
        "verdict": r.get("verdict"),
        "coverageState": r.get("coverageState"),
        "lastCrawlTime": r.get("lastCrawlTime"),
        "indexingState": r.get("indexingState"),
        "indexing_allowed": r.get("indexingState") == "INDEXING_ALLOWED" if r.get("indexingState") else None,
        "robotsTxtState": r.get("robotsTxtState"),
        "pageFetchState": r.get("pageFetchState"),
        "googleCanonical": r.get("googleCanonical"),
        "userCanonical": r.get("userCanonical"),
        "inspected_at": inspected_at,
    }


def not_inspected(url, why):
    return {"url": url, "verdict": None, "coverageState": "NOT_INSPECTED", "lastCrawlTime": None,
            "indexingState": None, "indexing_allowed": None, "inspected_at": None, "not_inspected_reason": why}


def write(urls, rows_by_url, state, named_stop, site, per_run):
    rows = [rows_by_url.get(u) or not_inspected(u, named_stop or "not reached this run") for u in urls]
    by_state = Counter(r["coverageState"] or "UNKNOWN" for r in rows)
    by_verdict = Counter(r["verdict"] or "NONE" for r in rows)
    buckets = Counter(bucket(r["coverageState"]) if r["coverageState"] != "NOT_INSPECTED" else "not_inspected" for r in rows)
    doc = {
        "schema_version": "1.0",
        "truth_source": "google_search_console_url_inspection",
        "site_url": site,
        "collected_at": now(),
        "state": state,
        "named_stop": named_stop,
        "sitemap_url_count": len(urls),
        "inspected_this_run": per_run,
        "quota": {"daily_limit_per_property": DAILY_QUOTA, "per_run_cap": PER_RUN_CAP},
        "summary": {
            "by_coverage_state": dict(sorted(by_state.items())),
            "by_verdict": dict(sorted(by_verdict.items())),
            "buckets": {k: buckets.get(k, 0) for k in ("indexed", "crawled_not_indexed", "discovered_not_indexed", "other", "not_inspected")},
        },
        "truth_boundary": "URL Inspection reports Google's index state for each URL at inspected_at. It is not a ranking or traffic measure; impressions come from gsc_search_analytics_export.json.",
        "urls": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    b = doc["summary"]["buckets"]
    print(f"index-coverage {state}: {len(urls)} sitemap URLs - indexed {b['indexed']}, crawled-not-indexed {b['crawled_not_indexed']}, "
          f"discovered-not-indexed {b['discovered_not_indexed']}, other {b['other']}, not inspected {b['not_inspected']} ({per_run} inspected this run)")


def main():
    urls = sitemap_urls()
    if not urls:
        print("index-coverage: sitemap.xml lists 0 URLs; nothing to inspect is a failure, not an empty success.", file=sys.stderr)
        return 1
    site = os.environ.get("GSC_SITE_URL", "").strip() or DEFAULT_PROPERTY
    info = service_account_info()
    previous = load_previous()
    carried = {r["url"]: r for r in (previous or {}).get("urls", []) if r.get("inspected_at")}

    if not info:
        stop = "NAMED STOP index-coverage: GSC_SERVICE_ACCOUNT_JSON is not set in this environment; the daily cycle supplies it from repository secrets."
        print(stop)
        if previous is None:
            write(urls, {}, "NAMED_STOP", stop, site, 0)
        return 0

    order = sorted(urls, key=lambda u: (carried.get(u, {}).get("inspected_at") or ""))
    batch = order[:PER_RUN_CAP]
    # Imported only once credentials exist, so a secretless run needs no Google client.
    sys.path.insert(0, str(ROOT / "distribution_scripts"))
    from gsc_inspect_urls import NUM_RETRIES, classify_hold  # same retry + hold rules as the deploy lane
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    local = threading.local()
    halt = threading.Event()
    hold_box = []

    def inspect(url):
        if halt.is_set():
            return None
        if not hasattr(local, "svc"):  # httplib2 is not thread-safe: one client per worker
            local.svc = build("searchconsole", "v1", credentials=creds, cache_discovery=False)
        try:
            body = {"inspectionUrl": url, "siteUrl": site, "languageCode": "en-US"}
            resp = local.svc.urlInspection().index().inspect(body=body).execute(num_retries=NUM_RETRIES)
            # The response does not echo the URL, so it is attached here.
            return {"inspectionUrl": url, **resp}
        except Exception as exc:  # noqa: BLE001 - every failure is recorded, none is swallowed
            held = classify_hold(exc)
            if held:
                halt.set()
                hold_box.append({"status": held[0], "detail": held[1], "first_url_refused": url})
                return None
            return {"inspectionUrl": url, "error": f"{type(exc).__name__}: {exc}"}

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = [r for r in pool.map(inspect, batch) if r]
    hold = hold_box[0] if hold_box else None
    stamp = now()
    rows = dict(carried)
    errors = []
    for resp in results:
        if resp.get("error"):
            errors.append(resp.get("inspectionUrl"))
            continue
        rows[resp.get("inspectionUrl")] = row_from(resp, stamp)
    inspected = len(results) - len(errors)

    if hold:
        if hold.get("status") == "HELD_CREDENTIAL":
            stop = (f"NAMED STOP index-coverage: Search Console refused URL Inspection ({hold.get('detail', '')[:160]}). "
                    f"Owner step: Search Console > property {site} > Settings > Users and permissions > Add user "
                    f"{info.get('client_email')} (if it is already listed with Restricted permission, raise it to Full). Nothing else is missing.")
        else:
            stop = f"NAMED STOP index-coverage: URL Inspection quota exhausted ({hold.get('detail', '')[:160]}); it resets daily. {inspected} URL(s) inspected this run are kept."
        print(stop)
        write(urls, rows, "NAMED_STOP", stop, site, inspected)
        return 0
    if inspected == 0:
        print(f"index-coverage: inspection failed and nothing was inspected; first errors: "
              f"{[r.get('error') for r in results[:3]]}", file=sys.stderr)
        return 1
    state = "OK" if not errors else "PARTIAL"
    if errors:
        print(f"::warning title=URL inspection partial::{len(errors)} URL(s) failed after retries: {', '.join(errors[:5])}")
    write(urls, rows, state, None, site, inspected)
    return 0


if __name__ == "__main__":
    sys.exit(main())

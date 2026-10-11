#!/usr/bin/env python3
"""Record whether Search Console has the sitemap registered, and register it if not.

On 2026-10-11 index coverage read 1 indexed, 37 crawled-not-indexed and 78
unknown to Google out of 116 sitemap URLs, while the deploy lane printed
"Submitting sitemap ... OK" on every run. A submit that returns OK says nothing
about what the property holds, so this step asks: sitemaps.list before, a
sitemaps.submit only when the sitemap is absent, sitemaps.list after. Both raw
list responses are written to data/search_intelligence/gsc_sitemaps.json and
validate:sitemap-registration checks the file is present, recent and shows the
sitemap registered.

No credentials: NAMED_STOP (exit 0), written only when no earlier record exists,
so a secretless run never blanks a real measurement. 401/403: NAMED_STOP with
the owner step. Submitted but still not listed afterwards: exit 1.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_gsc_export import service_account_info  # noqa: E402  same credential rules as the export

OUT = ROOT / "data/search_intelligence/gsc_sitemaps.json"
DEFAULT_PROPERTY = "sc-domain:porchandparty901.com"
SITEMAP_URL = "https://porchandparty901.com/sitemap.xml"


def now():
    return datetime.now(timezone.utc).isoformat()


def write(doc):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def listed(resp):
    return any(s.get("path") == SITEMAP_URL for s in (resp or {}).get("sitemap", []))


def main():
    site = os.environ.get("GSC_SITE_URL", "").strip() or DEFAULT_PROPERTY
    base = {"schema_version": "1.0", "collected_at": now(), "site": site, "sitemap_url": SITEMAP_URL}
    info = service_account_info()
    if not info:
        stop = "NAMED STOP gsc-sitemaps: GSC_SERVICE_ACCOUNT_JSON is not set in this environment; the daily cycle supplies it from repository secrets."
        print(stop)
        if not OUT.exists():
            write({**base, "state": "NAMED_STOP", "stop": stop})
        return 0

    sys.path.insert(0, str(ROOT / "distribution_scripts"))
    from gsc_inspect_urls import NUM_RETRIES, classify_hold
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/webmasters"])
    svc = build("searchconsole", "v1", credentials=creds, cache_discovery=False)
    try:
        before = svc.sitemaps().list(siteUrl=site).execute(num_retries=NUM_RETRIES)
        submitted = False
        if not listed(before):
            svc.sitemaps().submit(siteUrl=site, feedpath=SITEMAP_URL).execute(num_retries=NUM_RETRIES)
            submitted = True
        after = svc.sitemaps().list(siteUrl=site).execute(num_retries=NUM_RETRIES)
    except Exception as exc:  # noqa: BLE001
        held = classify_hold(exc)
        if not held:
            raise
        stop = (f"NAMED STOP gsc-sitemaps: Search Console refused sitemaps ({held[1][:160]}). Owner step: Search Console > "
                f"property {site} > Settings > Users and permissions > give {info.get('client_email')} Full permission.")
        print(stop)
        write({**base, "state": "NAMED_STOP", "stop": stop})
        return 0

    state = "REGISTERED" if listed(after) else "NOT_LISTED"
    write({**base, "state": state, "submitted_this_run": submitted,
           "listed_before": listed(before), "listed_after": listed(after),
           "list_before": before, "list_after": after})
    entry = next((s for s in after.get("sitemap", []) if s.get("path") == SITEMAP_URL), {})
    print(f"gsc-sitemaps {state}: listed before={listed(before)} submitted={submitted} listed after={listed(after)}; "
          f"lastSubmitted={entry.get('lastSubmitted')} lastDownloaded={entry.get('lastDownloaded')} "
          f"isPending={entry.get('isPending')} errors={entry.get('errors')} warnings={entry.get('warnings')} "
          f"contents={json.dumps(entry.get('contents'))}")
    if state != "REGISTERED":
        print(f"gsc-sitemaps: {SITEMAP_URL} was submitted and is still not listed on {site}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

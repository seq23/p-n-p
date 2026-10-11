#!/usr/bin/env python3
"""Collect the Search Console export that gsc_truth.json is built from.

Root cause this closes (2026-10-10): gsc_truth.json had read UNAVAILABLE /
EXPORT_NOT_PRESENT since 2026-08-07. The only caller of the collector
(distribution_scripts/gsc_search_analytics.py) was search-intelligence.yml, a
workflow_dispatch-only lane that had never been dispatched, so the export file
was never written. Meanwhile the daily cycle used the very same
GSC_SERVICE_ACCOUNT_JSON / GSC_SITE_URL secrets successfully every day for
queries:ingest. This script runs in that daily cycle instead.

Outcomes, each printed as one line:
  - credentials present, Search Console answers: writes the export for a rolling
    28-day window ending 3 days ago (Search Console's data lag), exit 0.
  - credentials absent: NAMED STOP naming the two secrets, exit 0, nothing
    written, and gsc_truth then reports UNAVAILABLE with that reason.
  - Search Console returns 403: NAMED STOP naming the exact service-account
    email to add as a user on the exact property, exit 0. Only the owner can
    grant that, so it must never red the cycle.
  - any other error: exit 1, loudly.
"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "data/search_intelligence/search_intelligence_contract.json").read_text())
GSC = CONTRACT["providers"]["search_console"]
EXPORT = ROOT / GSC["export_path"]
COLLECTOR = ROOT / GSC["collector"]


def service_account_info():
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "").strip()
    if raw.startswith("{"):
        return json.loads(raw)
    for candidate in (raw, os.environ.get("GSC_SERVICE_ACCOUNT_FILE", "").strip()):
        if candidate:
            p = Path(candidate)
            p = p if p.is_absolute() else ROOT / p
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
    return None


def main():
    site = os.environ.get("GSC_SITE_URL", "").strip()
    info = service_account_info()
    if not site or not info:
        print("NAMED STOP gsc-export: GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL are not both set in this "
              "environment; set them as repository secrets. gsc_truth stays UNAVAILABLE with that reason.")
        return 0

    end = date.today() - timedelta(days=3)
    start = end - timedelta(days=27)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(info, fh)
        key_path = fh.name
    try:
        os.chmod(key_path, 0o600)
        run = subprocess.run(
            [sys.executable, str(COLLECTOR), key_path, site, start.isoformat(), end.isoformat(), str(EXPORT)],
            capture_output=True, text=True)
    finally:
        os.unlink(key_path)

    if run.returncode == 0:
        print(run.stdout.strip().splitlines()[-1] if run.stdout.strip() else f"GSC export written: {EXPORT}")
        return 0
    err = (run.stderr or "") + (run.stdout or "")
    if "403" in err and ("permission" in err.lower() or "forbidden" in err.lower()):
        print(f"NAMED STOP gsc-export: Search Console refused the service account. Owner step: in Search Console, "
              f"property {site}, Settings > Users and permissions > Add user {info.get('client_email')} "
              f"with Restricted permission. Nothing else is missing.")
        return 0
    print("gsc-export: collector failed:\n" + "\n".join(err.strip().splitlines()[-15:]), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

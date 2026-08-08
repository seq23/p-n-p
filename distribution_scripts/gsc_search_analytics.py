#!/usr/bin/env python3
"""Real Google Search Console Search Analytics collector.

Google Search Console is the authority for actual own-site Google performance
(impressions, clicks, CTR, average position). This script performs a read-only
searchAnalytics.query against the verified property and writes a raw export.

It never fabricates rows. If the provider call fails, it exits non-zero and
writes nothing, so the downstream lane reports DEGRADED/UNAVAILABLE rather than
silently producing a green result.

Usage:
  gsc_search_analytics.py <service-account.json> <siteUrl> <startDate> <endDate> <outputJson> [rowLimit]

Auth scope is read-only: https://www.googleapis.com/auth/webmasters.readonly
"""

import json
import sys
from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def query_dimension(service, site_url, start_date, end_date, dimensions, row_limit):
    rows = []
    start_row = 0
    while True:
        body = {
            "startDate": start_date,
            "endDate": end_date,
            "dimensions": dimensions,
            "rowLimit": min(row_limit, 25000),
            "startRow": start_row,
        }
        response = service.searchanalytics().query(siteUrl=site_url, body=body).execute()
        batch = response.get("rows", [])
        rows.extend(batch)
        if len(batch) < body["rowLimit"] or len(rows) >= row_limit:
            break
        start_row += len(batch)
    return rows[:row_limit]


def main():
    if len(sys.argv) < 6:
        print(__doc__)
        sys.exit(1)

    creds_path = sys.argv[1]
    site_url = sys.argv[2]
    start_date = sys.argv[3]
    end_date = sys.argv[4]
    output_json = sys.argv[5]
    row_limit = int(sys.argv[6]) if len(sys.argv) > 6 else 5000

    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    service = build("searchconsole", "v1", credentials=creds)

    query_rows = query_dimension(service, site_url, start_date, end_date, ["query"], row_limit)
    page_rows = query_dimension(service, site_url, start_date, end_date, ["page"], row_limit)
    query_page_rows = query_dimension(service, site_url, start_date, end_date, ["query", "page"], row_limit)

    export = {
        "schema_version": "1.0",
        "truth_source": "google_search_console",
        "authoritative_for": ["impressions", "clicks", "ctr", "average_position"],
        "site_url": site_url,
        "start_date": start_date,
        "end_date": end_date,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "row_limit": row_limit,
        "provider_state": "OK",
        "by_query": query_rows,
        "by_page": page_rows,
        "by_query_page": query_page_rows,
        "counts": {
            "by_query": len(query_rows),
            "by_page": len(page_rows),
            "by_query_page": len(query_page_rows),
        },
        "truth_boundary": (
            "These are real Google Search Console rows for the verified property. "
            "average_position is Google's own averaged metric, not a single literal SERP rank observation."
        ),
    }

    with open(output_json, "w", encoding="utf-8") as handle:
        json.dump(export, handle, indent=2)
        handle.write("\n")

    print(
        "GSC search analytics export written: "
        f"{output_json} by_query={len(query_rows)} by_page={len(page_rows)} by_query_page={len(query_page_rows)}"
    )


if __name__ == "__main__":
    main()

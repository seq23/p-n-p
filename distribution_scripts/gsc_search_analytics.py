#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build


def load_queries(path):
    queries = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        query = raw.strip()
        if query:
            queries.append(query)
    return queries


def main():
    if len(sys.argv) != 7:
        print(
            "Usage: gsc_search_analytics.py <service-account.json> <siteUrl> <startDate> <endDate> <queryFile> <outputJson>",
            file=sys.stderr,
        )
        sys.exit(1)

    creds_path, site_url, start_date, end_date, query_file, output_json = sys.argv[1:]
    scopes = ["https://www.googleapis.com/auth/webmasters.readonly"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
    service = build("searchconsole", "v1", credentials=creds)
    queries = load_queries(query_file)
    rows = []

    for query in queries:
        body = {
            "startDate": start_date,
            "endDate": end_date,
            "dimensions": ["query", "page"],
            "dimensionFilterGroups": [
                {
                    "filters": [
                        {
                            "dimension": "query",
                            "operator": "equals",
                            "expression": query,
                        }
                    ]
                }
            ],
            "rowLimit": 25,
        }
        response = service.searchanalytics().query(siteUrl=site_url, body=body).execute()
        for row in response.get("rows", []):
            keys = row.get("keys", [])
            rows.append(
                {
                    "query": keys[0] if len(keys) > 0 else query,
                    "page": keys[1] if len(keys) > 1 else "",
                    "clicks": row.get("clicks", 0),
                    "impressions": row.get("impressions", 0),
                    "ctr": row.get("ctr", 0),
                    "position": row.get("position", 0),
                }
            )

    out = {
        "schema_version": "1.0",
        "site_url": site_url,
        "start_date": start_date,
        "end_date": end_date,
        "queried_terms": len(queries),
        "rows": rows,
        "truth_boundary": "Google Search Console Search Analytics is own-site Google performance truth. It is not a full literal SERP ranking report.",
    }
    Path(output_json).parent.mkdir(parents=True, exist_ok=True)
    Path(output_json).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} GSC Search Analytics rows to {output_json}")


if __name__ == "__main__":
    main()

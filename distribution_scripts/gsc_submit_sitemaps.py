#!/usr/bin/env python3
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

# Same transport as gsc_inspect_urls.py, same class of fault: a single socket
# timeout with zero retries failed the whole lane on 2026-09-17. Retried with
# backoff for socket/connection/SSL errors, 429 and 5xx.
NUM_RETRIES = 5

def main():
    if len(sys.argv) < 4:
        print("Usage: gsc_submit_sitemaps.py <service-account.json> <siteUrl> <sitemapUrl1> [sitemapUrl2 ...]")
        sys.exit(1)

    creds_path = sys.argv[1]
    site_url = sys.argv[2]
    sitemap_urls = sys.argv[3:]

    scopes = ["https://www.googleapis.com/auth/webmasters"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
    service = build("searchconsole", "v1", credentials=creds)

    for sitemap_url in sitemap_urls:
        if not sitemap_url:
            continue
        print(f"Submitting sitemap: {sitemap_url}")
        service.sitemaps().submit(siteUrl=site_url, feedpath=sitemap_url).execute(num_retries=NUM_RETRIES)
        print("OK")

if __name__ == "__main__":
    main()

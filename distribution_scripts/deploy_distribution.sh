#!/usr/bin/env bash
set -euo pipefail
HOST=""; KEY=""; ARTIFACT_DIR=""; GSC_CREDS=""; GSC_SITE_URL=""; ALLOW_MIXED="0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift 2 ;;
    --key) KEY="${2:?}"; shift 2 ;;
    --artifact-dir) ARTIFACT_DIR="${2:?}"; shift 2 ;;
    --creds) GSC_CREDS="${2:?}"; shift 2 ;;
    --gsc-site) GSC_SITE_URL="${2:?}"; shift 2 ;;
    --allow-mixed) ALLOW_MIXED="1"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done
HOST="${HOST:-porchandparty901.com}"
ARTIFACT_DIR="${ARTIFACT_DIR:-.build}"
PRIORITY_FILE="$ARTIFACT_DIR/indexnow-priority.txt"; BATCH_FILE="$ARTIFACT_DIR/indexnow-batch.txt"; RECEIPT="$ARTIFACT_DIR/distribution-receipt.json"
[[ -f "$PRIORITY_FILE" && -f "$BATCH_FILE" ]] || { echo "ERROR: validated distribution artifacts are missing" >&2; exit 1; }
if [[ -z "$KEY" ]]; then
  keyfile="$(find . -maxdepth 1 -type f -name '*.txt' | grep -E './[0-9a-fA-F-]{32,64}\.txt$' | head -1 || true)"
  [[ -n "$keyfile" ]] || { echo "ERROR: IndexNow key file not found" >&2; exit 1; }
  KEY="$(basename "$keyfile" .txt)"
fi
indexnow_status="NOT_RUN"; gsc_sitemap_status="NOT_CONFIGURED"; gsc_inspection_status="NOT_CONFIGURED"
set +e
if [[ "$ALLOW_MIXED" == "1" ]]; then
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$PRIORITY_FILE" --allow-mixed
  rc1=$?
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$BATCH_FILE" --allow-mixed
  rc2=$?
else
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$PRIORITY_FILE"
  rc1=$?
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$BATCH_FILE"
  rc2=$?
fi
set -e
if [[ $rc1 -eq 0 && $rc2 -eq 0 ]]; then indexnow_status="SUBMITTED"; else indexnow_status="FAILED"; fi
if [[ -n "$GSC_CREDS" && -n "$GSC_SITE_URL" && -f "$GSC_CREDS" ]]; then
  if python3 distribution_scripts/gsc_submit_sitemaps.py "$GSC_CREDS" "$GSC_SITE_URL" "https://${HOST}/sitemap.xml"; then gsc_sitemap_status="SUBMITTED"; else gsc_sitemap_status="FAILED"; fi
  if python3 distribution_scripts/gsc_inspect_urls.py "$GSC_CREDS" "$GSC_SITE_URL" "$PRIORITY_FILE" "$ARTIFACT_DIR/inspection-results.json"; then gsc_inspection_status="COMPLETED"; else gsc_inspection_status="FAILED"; fi
fi
python3 - "$RECEIPT" "$HOST" "$indexnow_status" "$gsc_sitemap_status" "$gsc_inspection_status" <<'PY'
import json,sys,datetime,pathlib
out,host,indexnow,gsc_sitemap,gsc_inspection=sys.argv[1:]
receipt={"schema_version":"1.0","recorded_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"host":host,"indexnow":indexnow,"gsc_sitemap":gsc_sitemap,"gsc_inspection":gsc_inspection,"truth_boundary":"SUBMITTED means the provider request completed without local error. It does not prove indexing, ranking, LLM surfacing, or citation."}
pathlib.Path(out).write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf-8")
print(json.dumps(receipt,indent=2))
PY
if [[ "$indexnow_status" == "FAILED" || "$gsc_sitemap_status" == "FAILED" || "$gsc_inspection_status" == "FAILED" ]]; then exit 1; fi

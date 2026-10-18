#!/usr/bin/env bash
# Inventory Publish -> admin status report (functions/_lib/inventory.mjs handleReport).
# Usage: report.sh started|pushed|unchanged|failed. Needs REPORT_KEY, PUBLISH_ID, RUN_URL.
# Never fails the workflow: a lost report only delays what Settings shows (the live page decides).
state="$1"
if [ -z "${REPORT_KEY:-}" ]; then echo "report: no PNP_INVENTORY_REPORT_KEY secret; Settings waits for the live page instead."; exit 0; fi
body=$(printf '{"publish_id":%s,"state":"%s","run_url":"%s","ts":%s}' "$PUBLISH_ID" "$state" "$RUN_URL" "$(date +%s)")
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$REPORT_KEY" -hex | sed 's/^.*= //')
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H 'Content-Type: application/json' -H "X-PNP-Signature: $sig" --data "$body" "${SITE:-https://porchandparty901.com}/api/inventory/report" || echo 000)
echo "report $state for #$PUBLISH_ID: HTTP $code"
exit 0

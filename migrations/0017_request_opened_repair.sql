-- Repair of the NEW badge (19 Oct 2026; functions/_lib/request-new.mjs). Migration 0016 marked every
-- request already in D1 as opened ('before the NEW badge'), so requests that arrived in the days
-- before it shipped never wore NEW. Un-open the backfilled rows for requests still waiting on
-- Valerie: status still New (or no status row), not put away, not a phone call, submitted on or
-- after 16 Oct 2026. Only rows the backfill wrote are touched; a real open is never removed.
DELETE FROM request_opened
WHERE how = 'before the NEW badge'
  AND request_key IN (
    SELECT r.request_key FROM requests r
    LEFT JOIN request_status s ON s.request_key = r.request_key
    WHERE r.submitted_at >= '2026-10-16'
      AND r.source <> 'phone'
      AND (s.request_key IS NULL OR (s.status = 'new' AND s.archived_at IS NULL))
  );

// Daily full Google Sheet resync, asked for by the pnp-mailer cron (docs/admin-console.md).
// Outside the session guard because a cron has no cookie: the 64-hex token in
// settings.sync_token (migration 0005) IS the auth. Wrong token: 404. POST only. Noindex.
import { handleSync } from '../../_lib/sync-route.mjs';

export const onRequest = (context) => handleSync(context);

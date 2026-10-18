// Private ICS feed for Google Calendar: /api/calendar/<secret-token>.ics (docs/admin-console.md).
// The ONE admin route outside the session guard, because Google fetches it with no cookie:
// the 64-hex-character token in settings.calendar_token IS the auth. A wrong or missing token
// is a plain 404. Every answer says noindex; the feed is never in the sitemap or llms files
// (validate:admin-noindex). Only GET and HEAD.
import { handleIcs } from '../../_lib/ics-route.mjs';

export const onRequest = (context) => handleIcs(context);

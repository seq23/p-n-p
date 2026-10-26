// Read-only owner feed for Boss OS: GET /api/owner-feed?range=day|week with
// `Authorization: Bearer <OWNER_FEED_TOKEN>`. Everything lives in functions/_lib/owner-feed.mjs
// (the same list as Valerie's 7 AM email); validate:owner-feed holds it to its contract.
import { handleOwnerFeed } from '../_lib/owner-feed.mjs';

export const onRequest = (context) => handleOwnerFeed(context);

// POST /api/friends: friend codes, map sync and friend lists.
// Needs Upstash Redis connected to the Vercel project (KV_REST_API_URL and
// KV_REST_API_TOKEN). Without it, every call answers 503 "not-configured".

import { handleRequest } from "../server/friends.mjs";

export default {
  fetch(request) {
    return handleRequest(request);
  },
};

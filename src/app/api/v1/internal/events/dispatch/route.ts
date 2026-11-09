import { route } from "@/lib/http";
import { dispatch } from "@/lib/events/dispatcher";

// Scoped machine credential only: not reachable with any user session. Retries pending webhook
// deliveries. The scheduled GitHub Actions job calls this, and it doubles as the database keep-alive.
// Returns counts only.
export const POST = route({
  access: "machine",
  handler: async ({ cid }) => ({ json: await dispatch(cid) }),
});

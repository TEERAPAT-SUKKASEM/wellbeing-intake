// GET /api/v1/me: tell the web app who the signed-in staff member is.
// Who can call it: practitioners and admins (signed in). Students never call it.
// What it does: route() reads the session cookie or Bearer token, then finds the matching staff row
//   and its role. The handler only returns what route() found.
// Returns: 200 { id, role, displayName }; 401 if nobody is signed in; 404 if the account has no staff role.
import { route } from "@/lib/http";

// Staff only. Lets the UI decide which screen to show; the real checks are on each route.
export const GET = route({
  access: ["practitioner", "admin"],
  // The "!" after caller is safe: on a role-protected route, route() only runs the handler with a caller.
  // No email is returned, only what the screen needs.
  handler: async ({ caller }) => ({
    json: { id: caller!.id, role: caller!.role, displayName: caller!.displayName },
  }),
});

import { route } from "@/lib/http";

// Staff only. Lets the UI decide which screen to show; the real checks are on each route.
export const GET = route({
  access: ["practitioner", "admin"],
  handler: async ({ caller }) => ({
    json: { id: caller!.id, role: caller!.role, displayName: caller!.displayName },
  }),
});

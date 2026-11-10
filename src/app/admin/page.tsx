// What this page does: the admin workspace for editing services and weekly opening hours.
// URL: /admin
// Talks to: no API calls itself. AdminWorkspace calls GET /api/v1/admin/services,
//   PATCH /api/v1/admin/services/{id}, and GET and PUT /api/v1/admin/availability.
// Note: the real permission check is done by the API. A signed-out user (401) is sent to /sign-in.
import { AdminWorkspace } from "@/components/AdminWorkspace";
// No sign-in check here. AdminWorkspace learns it from the API and redirects to /sign-in?next=/admin.
export default function AdminPage() {
  return <AdminWorkspace />;
}

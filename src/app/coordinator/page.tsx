// What this page does: sends anyone who opens the old coordinator address to the admin page instead.
// URL: /coordinator (redirects to /admin)
// Talks to: no API calls.
// Note: kept only so old links and bookmarks still work.
import { redirect } from "next/navigation";
// The coordinator role was retired by the new PRD.
export default function CoordinatorPage() {
  // redirect() runs on the server, so the browser goes straight to /admin and this page never shows.
  redirect("/admin");
}

import { redirect } from "next/navigation";
// The coordinator role was retired by the new PRD.
export default function CoordinatorPage() {
  redirect("/admin");
}

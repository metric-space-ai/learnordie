import { redirect } from "next/navigation";

import { clearLecturerSession } from "@/server/auth";

export async function GET() {
  await clearLecturerSession();
  redirect("/");
}

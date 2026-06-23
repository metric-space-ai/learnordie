import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

import { consumeMagicToken, isPlausibleSignedToken } from "@/server/auth";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) redirect("/lecturer/login");
  if (!isPlausibleSignedToken(token)) redirect("/lecturer/login?error=invalid-token");

  const session = await consumeMagicToken(token);
  if (!session) redirect("/lecturer/login?error=invalid-token");

  redirect("/lecturer");
}

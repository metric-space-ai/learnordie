import { NextResponse } from "next/server";

import { getStudentRepository } from "@/server/student-repository";
import { getCurrentStudentProfile } from "@/server/student-session";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentStudentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Bitte zuerst ein Pseudonym wählen." }, { status: 401 });
  }

  const { id } = await context.params;
  const removed = await getStudentRepository().removeEnrollment(profile.id, id);
  if (!removed) {
    return NextResponse.json({ error: "Vorlesung nicht gefunden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

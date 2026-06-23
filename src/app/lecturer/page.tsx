import { redirect } from "next/navigation";

import { LecturerDashboard } from "@/components/LecturerDashboard";
import { createLecturerCsrfToken, getLecturerSession } from "@/server/auth";
import { getLectureRepository } from "@/server/repository";

function stringParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function dashboardErrorMessage(params: Record<string, string | string[] | undefined>) {
  const error = stringParam(params.error);
  if (error === "upload-too-large") {
    return stringParam(params.message) || "Datei zu groß. Bitte kleinere Quelle wählen.";
  }
  if (error === "request-too-large") return "Anfrage zu groß. Bitte Seite neu laden und erneut versuchen.";
  if (error === "material-upload-failed") return "Material konnte nicht hochgeladen werden.";
  if (error === "missing-material") return "Keine Quelle ausgewählt.";
  return "";
}

export default async function LecturerDashboardPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getLecturerSession();
  if (!session) redirect("/lecturer/login");

  const params = await searchParams ?? {};
  const lectures = await getLectureRepository().listLectures(session.email);
  const initialTool = stringParam(params.tool) === "materials" ? "materials" : undefined;

  return (
    <LecturerDashboard
      initialLectures={lectures}
      initialError={dashboardErrorMessage(params)}
      initialTool={initialTool}
      csrfToken={createLecturerCsrfToken(session)}
    />
  );
}

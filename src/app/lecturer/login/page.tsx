import { LoginForm } from "./LoginForm";

export default async function LecturerLoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const magicLink = typeof params.magicLink === "string" ? params.magicLink : "";
  const sent = params.sent === "1";
  const errorCode = typeof params.error === "string" ? params.error : "";
  const errorMessage =
    errorCode === "invalid-email"
      ? "Bitte eine gültige E-Mail eingeben."
      : errorCode === "invalid-token"
        ? "Dieser Anmeldelink ist abgelaufen oder wurde bereits verwendet."
      : errorCode === "rate-limited"
        ? "Zu viele Anfragen. Bitte später erneut versuchen."
      : errorCode === "send-failed"
        ? "Anmeldelink konnte nicht versendet werden."
        : "";

  return (
    <main className="mode-screen lb-motion-root">
      <section className="mode-card lb-enter-sheet">
        <p className="eyebrow">Dozentenbereich</p>
        <h1>Einloggen oder Konto erstellen</h1>
        <p>
          Eine dienstliche E-Mail reicht. Ist die Adresse neu, wird dein Dozentenkonto
          nach der Link-Bestätigung erstellt; ist sie bekannt, wirst du direkt angemeldet.
        </p>
        <LoginForm initialMagicLink={magicLink} sent={sent} initialError={errorMessage} />
      </section>
    </main>
  );
}

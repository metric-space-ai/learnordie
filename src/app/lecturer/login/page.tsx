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
        ? "Dieser Anmeldelink ist abgelaufen oder wurde bereits verwendet. Bitte einen neuen Link anfordern."
      : errorCode === "rate-limited"
        ? "Zu viele Anfragen. Bitte später erneut versuchen."
      : errorCode === "send-failed"
        ? "Anmeldelink konnte nicht versendet werden. Bitte erneut versuchen."
        : "";

  return (
    <main className="join-screen app-canvas lb-motion-root">
      <section className="join-card app-island mode-card lb-enter-sheet" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <p className="eyebrow">Dozentenbereich</p>
        <h1 id="login-title">Mit dienstlicher E-Mail anmelden</h1>
        <p className="join-lead">
          Kein Passwort. Wir senden einen Anmeldelink. Ist die Adresse neu, entsteht das Dozentenkonto
          nach der Bestätigung; ist sie bekannt, landest du direkt im Studio.
        </p>
        <LoginForm initialMagicLink={magicLink} sent={sent} initialError={errorMessage} />
      </section>
    </main>
  );
}

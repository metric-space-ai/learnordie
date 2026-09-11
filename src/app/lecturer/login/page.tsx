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
        ? "Dieser Link ist abgelaufen oder wurde schon verwendet. Fordere einen Code an."
      : errorCode === "rate-limited"
        ? "Zu viele Anfragen. Bitte später erneut versuchen."
      : errorCode === "send-failed"
        ? "Code konnte nicht gesendet werden. Versuche es gleich noch einmal."
        : "";

  return (
    <main className="mode-screen login-screen lb-motion-root">
      <section className="mode-card login-card lb-enter-sheet">
        <h1>Anmelden</h1>
        <LoginForm initialMagicLink={magicLink} sent={sent} initialError={errorMessage} />
      </section>
    </main>
  );
}

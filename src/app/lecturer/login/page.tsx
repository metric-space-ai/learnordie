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
        ? "Dieser Magic Link ist abgelaufen oder wurde bereits verwendet."
      : errorCode === "rate-limited"
        ? "Zu viele Magic-Link-Anfragen. Bitte später erneut versuchen."
      : errorCode === "send-failed"
        ? "Magic Link konnte nicht versendet werden."
        : "";

  return (
    <main className="mode-screen lb-motion-root">
      <section className="mode-card lb-enter-sheet">
        <p className="eyebrow">Referentenlogin</p>
        <h1>Login per Magic Link</h1>
        <p>Produktiv wird der Link per Mail versendet. Nur im lokalen Console-Modus zeigt die App einen Testlink direkt an.</p>
        <LoginForm initialMagicLink={magicLink} sent={sent} initialError={errorMessage} />
      </section>
    </main>
  );
}

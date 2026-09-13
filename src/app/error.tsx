"use client";

import { AppStatus } from "@/components/AppStatus";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppStatus title="Die Seite konnte nicht geladen werden">
      <p role="alert">Bitte versuche es erneut. Bereits gespeicherte Inhalte bleiben erhalten.</p>
      <button type="button" className="primary-button" onClick={reset}>Erneut versuchen</button>
    </AppStatus>
  );
}

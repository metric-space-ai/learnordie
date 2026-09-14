import { AppStatus } from "@/components/AppStatus";

export default function NotFound() {
  return (
    <AppStatus title="Diese Seite gibt es nicht">
      <p>Prüfe den Vorlesungslink oder gib auf der Startseite den Vorlesungscode ein.</p>
    </AppStatus>
  );
}
